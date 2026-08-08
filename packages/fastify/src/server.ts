import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import {
    type AdapterRequest,
    type RouteDefinition,
    type Routes,
    type RouteHandler as CoreRouteHandler,
    type Router as CoreRouter,
    type ApiWithRouter,
    type ErrorFormatter,
    type GuardMap,
    type GuardRun,
    type GuardDeny,
    type GuardDenial,
    type RequestContextMap,
    type RequestContextRun,
    type ApiParts,
    ROUTER_META,
    GUARDS_META,
    SCHEMES_META,
    REQUEST_CONTEXT_META,
    assembleApi,
    createAdapter,
    renderJsonResult,
} from '@ts-kizuna/core/adapter';
import type { z } from 'zod';
import type {
    Contract,
    TagOptions,
    SecurityScheme,
    HandlersFromAuth,
    GuardSuccess,
    CredentialOf,
    GuardParams,
    RequestContextSchema,
    RequestContextHeaderValues,
    RequestContextValues,
} from '@ts-kizuna/core';

export type FastifyApi<R extends Routes = Routes> = R &
    ApiWithRouter & {
        readonly [GUARDS_META]?: unknown;
        readonly [SCHEMES_META]?: unknown;
        readonly [REQUEST_CONTEXT_META]?: unknown;
    };

export interface FastifyHandlerContext {
    request: FastifyRequest;
    reply: FastifyReply;
}

/**
 * The handler type for a single route, typed against its contract definition.
 */
export type RouteHandler<R extends RouteDefinition> = CoreRouteHandler<R, FastifyHandlerContext>;

/**
 * The handler tree for a contract or route group, typed against it. Routes
 * secured by the contract's `auth` map additionally receive each required
 * identity's context in their handler args, under `auth`, keyed by the identity's name.
 */
export type Router<C> =
    C extends Contract<infer R, infer _Tags, infer _Codes, infer Schemes, infer Auth, infer RequestContext>
        ? HandlersFromAuth<R, FastifyHandlerContext & RequestContextValues<RequestContext>, Schemes, Auth>
        : C extends Routes
          ? CoreRouter<C, FastifyHandlerContext>
          : never;

/**
 * The handlers for a group named on the contract, or for a bare route group.
 * Both forms resolve through one signature: a second candidate of the same
 * arity costs zero-argument handlers their contextual type.
 */
type GroupRouter<Source, GroupOrRoutes> = GroupOrRoutes extends string
    ? Router<Source>[Extract<GroupOrRoutes, keyof Router<Source>>]
    : Router<GroupOrRoutes>;

declare module 'fastify' {
    interface FastifyRequest {
        kizunaRoute?: RouteDefinition;
    }
}

export type FastifyPreHandler = (request: FastifyRequest, reply: FastifyReply) => void | Promise<void>;

export interface FastifyOptions {
    /**
     * Validate handler return values against the routes' response schemas.
     * Mismatches surface as 500 errors. Intended for development; disable in
     * production.
     *
     * @default false
     */
    responseValidation?: boolean;
    /**
     * Reshape error (status >= 400) response bytes before they are sent. See
     * {@link ErrorFormatter}.
     */
    formatError?: ErrorFormatter<FastifyRequest>;
}

/**
 * A guard per identity, keyed by name. Each receives the handler context, a
 * `deny` helper, and the matched route's required scopes, and returns that
 * identity's {@link GuardSuccess} (its context and access fields) or a `deny(...)`
 * result. Keying by name lets each guard's return be typed against its own
 * identity, so access values narrow without an annotation. An
 * authentication-only identity (no context, no access) returns nothing on
 * success, or `deny(...)`.
 */
type GuardFns<Schemes extends Record<string, SecurityScheme>, Params> = {
    [Name in keyof Schemes]: (
        args: FastifyHandlerContext &
            CredentialOf<Schemes[Name]> & {
                params: Params;
                deny: GuardDeny;
                scopes: string[];
            }
    ) => [keyof GuardSuccess<Schemes[Name]>] extends [never]
        ? void | GuardDenial | Promise<void | GuardDenial>
        : GuardSuccess<Schemes[Name]> | GuardDenial | Promise<GuardSuccess<Schemes[Name]> | GuardDenial>;
};

/**
 * One guard per identity declared on the contract.
 */
type GuardsForSchemes<Schemes extends Record<string, SecurityScheme>> = {
    [Name in keyof Schemes]: GuardRun<FastifyHandlerContext>;
};

/**
 * The resolver functions for the request context schemas declared on `kizuna`,
 * keyed by name. Each runs on every route and returns its schema's value.
 */
type RequestResolverFns<RequestContext extends Record<string, RequestContextSchema>> = {
    [Name in keyof RequestContext]: (
        args: FastifyHandlerContext & {
            params: Record<string, string>;
            headers: RequestContextHeaderValues<RequestContext[Name]>;
        }
    ) => z.output<RequestContext[Name]['context']> | Promise<z.output<RequestContext[Name]['context']>>;
};

interface FastifyResponseContext {
    reply: FastifyReply;
    formatError?: ErrorFormatter<FastifyRequest>;
}

const adapter = createAdapter<FastifyRequest, void, FastifyHandlerContext, FastifyResponseContext>({
    buildHandlerContext: (adapterRequest, { reply }) => ({
        request: adapterRequest.request,
        reply,
    }),
    respond: (result, { reply, formatError }) => {
        if (result.kind === 'handler-error') {
            throw result.error;
        }
        if (result.kind === 'raw-response') {
            return;
        }
        const rendered = renderJsonResult(result, formatError as ErrorFormatter, reply.request);
        for (const [key, value] of Object.entries(rendered.headers)) {
            reply.header(key, value);
        }
        if (rendered.body === undefined) {
            reply.status(rendered.status).send();
        } else if (rendered.raw) {
            const body = rendered.body;
            // Strings go out as-is; binary (Uint8Array/Buffer) is sent as bytes — never JSON-serialized.
            reply.status(rendered.status).send(typeof body === 'string' || Buffer.isBuffer(body) ? body : Buffer.from(body as Uint8Array));
        } else {
            reply.status(rendered.status).send(rendered.body);
        }
    },
});

export interface KizunaPluginOptions extends FastifyOptions {
    /**
     * The API object built by `server.api`.
     */
    api: FastifyApi;
}

/**
 * Fastify plugin that mounts a ts-kizuna API.
 *
 * @example
 * const app = Fastify();
 * app.register(fastifyKizuna, {
 *     api,
 * });
 */
export const fastifyKizuna = fastifyPlugin(
    async (app: FastifyInstance, options: KizunaPluginOptions) => {
        const { api } = options;
        const resolvedRouter = api[ROUTER_META] as CoreRouter<Routes, FastifyHandlerContext>;
        const guards = api[GUARDS_META] as GuardMap<FastifyHandlerContext> | undefined;
        const schemes = api[SCHEMES_META] as Record<string, SecurityScheme> | undefined;
        const requestContext = api[REQUEST_CONTEXT_META] as RequestContextMap<FastifyHandlerContext> | undefined;

        // Fastify's auto-exposed HEAD collides with a declared one, but it skips paths that already have HEAD.
        const declaredRoutes = [...adapter.eachRoute(api as unknown as Routes, resolvedRouter)].sort(
            (left, right) => Number(right.route.method === 'HEAD') - Number(left.route.method === 'HEAD')
        );

        for (const { routeKey, route } of declaredRoutes) {
            app.route({
                method: route.method,
                url: route.path,
                preHandler: [
                    async (request: FastifyRequest) => {
                        request.kizunaRoute = route;
                    },
                ],
                handler: async (request: FastifyRequest, reply: FastifyReply) => {
                    const adapterRequest: AdapterRequest<FastifyRequest> = {
                        request,
                        method: request.method,
                        resolution: {
                            kind: 'pre-resolved',
                            routeKey,
                            route,
                            params: (request.params ?? {}) as Record<string, string>,
                        },
                        query: (request.query ?? {}) as Record<string, string>,
                        headers: request.headers,
                        readBody: () => request.body,
                    };

                    await adapter.handle({
                        routes: api as unknown as Routes,
                        router: resolvedRouter,
                        request: adapterRequest,
                        responseContext: {
                            reply,
                            formatError: options?.formatError,
                        },
                        guards,
                        schemes,
                        requestContext,
                        responseValidation: options?.responseValidation,
                    });
                },
            });
        }
    },
    {
        name: '@ts-kizuna/fastify',
    }
);

type ServerContract<
    R extends Routes,
    Schemes extends Record<string, SecurityScheme>,
    Auth,
    RequestContext extends Record<string, RequestContextSchema>,
> = Contract<R, Record<string, TagOptions>, string, Schemes, Auth, RequestContext>;

export interface Server<
    R extends Routes,
    Schemes extends Record<string, SecurityScheme>,
    Auth,
    RequestContext extends Record<string, RequestContextSchema>,
> {
    /**
     * Define a guard for one of the contract's identities. It runs before the
     * handlers of every route whose `auth` entry requires the identity, and
     * receives the credential its method extracted (`bearer`, `apiKey`, or
     * `basic` — `null` when absent). Return the identity's context and access
     * fields to allow the request, or call `deny(status, detail)`.
     */
    guard<const Name extends Extract<keyof Schemes, string>>(
        name: Name,
        run: GuardFns<Schemes, GuardParams<R, Auth, Name>>[Name]
    ): GuardRun<FastifyHandlerContext>;
    /**
     * Define a request context resolver declared on the contract. It runs on
     * every route — public ones included — and never denies.
     */
    requestContext<const Name extends Extract<keyof RequestContext, string>>(
        name: Name,
        run: RequestResolverFns<RequestContext>[Name]
    ): RequestContextRun<FastifyHandlerContext>;
    /**
     * Bind typed handlers to the contract or one of its route groups.
     */
    router: {
        <const GroupOrRoutes extends Extract<keyof Router<ServerContract<R, Schemes, Auth, RequestContext>>, string> | Routes>(
            group: GroupOrRoutes,
            router: GroupRouter<ServerContract<R, Schemes, Auth, RequestContext>, GroupOrRoutes>
        ): GroupRouter<ServerContract<R, Schemes, Auth, RequestContext>, GroupOrRoutes>;
        (router: Router<ServerContract<R, Schemes, Auth, RequestContext>>): Router<ServerContract<R, Schemes, Auth, RequestContext>>;
    };
    /**
     * Assemble the router and guards into the api object.
     */
    api(
        options: {
            router: Router<ServerContract<R, Schemes, Auth, RequestContext>>;
            guards?: NoInfer<GuardsForSchemes<Schemes>>;
        } & (string extends keyof RequestContext
            ? { requestContext?: undefined }
            : { requestContext: NoInfer<{ [Name in keyof RequestContext]: RequestContextRun<FastifyHandlerContext> }> })
    ): FastifyApi<R>;
}

/**
 * Bind a contract to a server handle: the server-side counterpart to `kizuna`'s
 * `k`.
 *
 * @example
 * const { server } = createServer(contract);
 *
 * const requireUser = server.guard('user', ({ bearer, deny }) => {
 *     const session = bearer && sessions.get(bearer.token);
 *     return session ? { userId: session.userId } : deny(401, 'Unauthorized');
 * });
 *
 * export const api = server.api({
 *     router,
 *     guards: {
 *         user: requireUser,
 *     },
 * });
 */
export const createServer = <
    const R extends Routes,
    Schemes extends Record<string, SecurityScheme>,
    Auth,
    RequestContext extends Record<string, RequestContextSchema>,
>(
    contract: ServerContract<R, Schemes, Auth, RequestContext>
): { server: Server<R, Schemes, Auth, RequestContext> } => {
    const server = {
        guard: (_name: string, run: unknown) => run,
        requestContext: (_name: string, run: unknown) => run,
        router: (groupOrRouter: unknown, groupRouter?: unknown) => groupRouter ?? groupOrRouter,
        api: (options: ApiParts) => assembleApi(contract, options),
    };
    return { server: server as unknown as Server<R, Schemes, Auth, RequestContext> };
};
