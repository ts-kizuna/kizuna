import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import {
    type AdapterRequest,
    type RouteDefinition,
    type Routes,
    type MiddlewareMap,
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
    ROUTER_META,
    GUARDS_META,
    SCHEMES_META,
    REQUEST_CONTEXT_META,
    MIDDLEWARE_META,
    createAdapter,
    createApi as coreApi,
    resolveMiddleware,
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
        readonly [MIDDLEWARE_META]?: unknown;
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
 * identity's context in their handler args, under the identity's name.
 */
export type Router<C> =
    C extends Contract<infer R, infer _Tags, infer _Codes, infer Schemes, infer Auth, infer RequestContext>
        ? HandlersFromAuth<R, FastifyHandlerContext & RequestContextValues<RequestContext>, Schemes, Auth>
        : C extends Routes
          ? CoreRouter<C, FastifyHandlerContext>
          : never;

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
 * Bind typed handler implementations to a contract or route group.
 *
 * @example
 * export const router = createRouter(contract, {
 *     listUsers: ({ query }) => ({ status: 200, body: { users: [], total: 0 } }),
 *     createUser: ({ body }) => ({ status: 201, body: { id: '1', ...body } }),
 * });
 */
export const createRouter: {
    <const C extends Contract, const Group extends Extract<keyof Router<C>, string>>(
        source: C,
        group: Group,
        router: Router<C>[Group]
    ): Router<C>[Group];
    <const C extends Contract | Routes>(source: C, router: Router<C>): Router<C>;
} = (_source: unknown, groupOrRouter: unknown, groupRouter?: unknown) => (groupRouter ?? groupOrRouter) as never;

/**
 * Declare per-route middleware in the same shape as the contract's or group's routes.
 *
 * @deprecated Define auth with identities + the contract's `auth` map and pass
 * `guards` to `createApi`. See /docs/auth.
 *
 * @example
 * export const middleware = createMiddleware(contract, {
 *     listUsers: [authenticate],
 *     createUser: [authenticate, adminOnly],
 * });
 */
export const createMiddleware = <const R extends Routes>(
    _source: Contract<R, Record<string, TagOptions>, string> | R,
    map: MiddlewareMap<R, FastifyPreHandler>
): MiddlewareMap<R, FastifyPreHandler> => map;

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

/**
 * Implement a request context provider declared on `kizuna` under `context`. It
 * runs on every route — public ones included — and never denies; handlers read
 * its value under the provider's name.
 *
 * @example
 * import { getHeaderValue } from '@ts-kizuna/core';
 *
 * export const captureAnalytics = createRequestContextResolver(contract, 'analytics', ({ request }) => ({
 *     sessionId: getHeaderValue(request.headers['x-posthog-session-id']) ?? null,
 * }));
 */
export function createRequestContextResolver<
    RequestContext extends Record<string, RequestContextSchema>,
    const Name extends Extract<keyof RequestContext, string>,
>(
    _contract: Contract<Routes, Record<string, TagOptions>, string, Record<string, SecurityScheme>, unknown, RequestContext>,
    _name: Name,
    run: RequestResolverFns<RequestContext>[Name]
): RequestContextRun<FastifyHandlerContext> {
    return run as unknown as RequestContextRun<FastifyHandlerContext>;
}

/**
 * Define a guard for an identity. It runs before the handlers of routes whose
 * `auth` entry requires the identity. The argument carries the request context
 * plus the credential the identity's method extracted (`bearer`, `apiKey`, or
 * `basic` — `null` when absent), a `deny` helper, and the route's `scopes`.
 * Return the identity's context and access fields to allow the request (read in
 * handlers under the identity's name), or call `deny(status, detail)`.
 *
 * @example
 * export const requireUser = createGuard(contract, 'user', async ({ bearer, deny }) => {
 *     const session = bearer && (await verify(bearer.token));
 *     if (!session) return deny(401, 'Unauthorized');
 *     return {
 *         userId: session.userId,
 *     };
 * });
 */
export function createGuard<
    const R extends Routes,
    Schemes extends Record<string, SecurityScheme>,
    Auth,
    const Name extends Extract<keyof Schemes, string>,
>(
    _contract: Contract<R, Record<string, TagOptions>, string, Schemes, Auth>,
    _identity: Name,
    run: GuardFns<Schemes, GuardParams<R, Auth, Name>>[Name]
): GuardRun<FastifyHandlerContext> {
    return run as unknown as GuardRun<FastifyHandlerContext>;
}

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

/**
 * Bind a contract to its router and a guard per identity.
 *
 * @example
 * export const api = createApi({
 *     contract,
 *     router,
 *     guards: {
 *         user: requireUser,
 *     },
 * });
 */
export const createApi = <
    const R extends Routes,
    Schemes extends Record<string, SecurityScheme>,
    Auth,
    RequestContext extends Record<string, RequestContextSchema>,
>(
    options: {
        contract: Contract<R, Record<string, TagOptions>, string, Schemes, Auth, RequestContext>;
        router: Router<Contract<R, Record<string, TagOptions>, string, Schemes, Auth, RequestContext>>;
        guards?: NoInfer<GuardsForSchemes<Schemes>>;
        /**
         * Per-route middleware, in the same shape as the contract's routes.
         *
         * @deprecated Define auth with identities + the contract's `auth` map and
         * pass `guards` instead. See /docs/auth.
         */
        middleware?: MiddlewareMap<R, FastifyPreHandler>;
    } & (string extends keyof RequestContext
        ? { requestContext?: undefined }
        : { requestContext: NoInfer<{ [Name in keyof RequestContext]: RequestContextRun<FastifyHandlerContext> }> })
): FastifyApi<R> => {
    const { contract, router, guards, requestContext, middleware } = options;
    const spec = coreApi(contract.routes);
    return Object.assign(spec, {
        [ROUTER_META]: router,
        [GUARDS_META]: guards,
        [SCHEMES_META]: contract.securitySchemes,
        [REQUEST_CONTEXT_META]: requestContext,
        [MIDDLEWARE_META]: middleware,
    }) as unknown as FastifyApi<R>;
};

export interface KizunaPluginOptions extends FastifyOptions {
    /**
     * The API object created with `createApi`.
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
        const middlewareMap = api[MIDDLEWARE_META] as MiddlewareMap<Routes, FastifyPreHandler> | undefined;

        for (const { routeKey, route } of adapter.eachRoute(api as unknown as Routes, resolvedRouter)) {
            const routeMiddleware = resolveMiddleware(routeKey, middlewareMap);

            app.route({
                method: route.method,
                url: route.path,
                preHandler: [
                    async (request: FastifyRequest) => {
                        request.kizunaRoute = route;
                    },
                    ...routeMiddleware,
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
