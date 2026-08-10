import type { FastifyInstance, FastifyRequest, FastifyReply, FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { Readable } from 'node:stream';
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
    API_META,
    ROUTER_META,
    GUARDS_META,
    SCHEMES_META,
    REQUEST_CONTEXT_META,
    pluginRoutesOf,
    pluginExportsOf,
    type PluginConfigs,
    type PluginArgs,
    type ContractPlugins,
    pluginRouterOf,
    assembleApi,
    createAdapter,
    renderJsonResult,
} from '@ts-kizuna/core/adapter';
import type { z } from 'zod';
import type {
    Contract,
    TagOptions,
    SecurityScheme,
    GuardSuccess,
    CredentialOf,
    RequestContextSchema,
    RequestContextHeaderValues,
} from '@ts-kizuna/core';
import type { HandlersFromAuth, GuardParams, RequestContextValues } from '@ts-kizuna/core/adapter';

export type FastifyApi<R extends Routes = Routes> = ApiWithRouter<R> & {
    readonly [GUARDS_META]?: unknown;
    readonly [SCHEMES_META]?: unknown;
    readonly [REQUEST_CONTEXT_META]?: unknown;
    /**
     * Register every contract route on a Fastify instance. Calls
     * `app.register` internally, so encapsulation behaves as Fastify expects.
     */
    mount: (app: FastifyInstance, options?: FastifyOptions) => Promise<void>;
    /**
     * The same routes as a Fastify plugin, for composing inside your own plugin
     * tree: `app.register(api.plugin, { prefix: '/v1' })`.
     */
    plugin: FastifyPluginAsync<FastifyOptions>;
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
    C extends Contract<infer R, infer _Tags, infer _Codes, infer Schemes, infer Auth, infer RequestContext, infer Plugins>
        ? HandlersFromAuth<R, FastifyHandlerContext & RequestContextValues<RequestContext> & PluginArgs<Plugins>, Schemes, Auth>
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

/**
 * Write a web `Response` to a Fastify reply. Plugins answer in web terms to stay
 * adapter-agnostic, so the translation belongs here.
 */
const writeWebResponse = async (response: unknown, reply: FastifyReply): Promise<void> => {
    if (!(response instanceof globalThis.Response)) return;
    reply.hijack();
    reply.raw.statusCode = response.status;
    response.headers.forEach((value, name) => reply.raw.setHeader(name, value));
    if (!response.body) {
        reply.raw.end();
        return;
    }
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]).pipe(reply.raw);
};

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
            void writeWebResponse(result.response, reply);
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
     * The API object built by `new KizunaApi()`.
     */
    api: FastifyApi;
}

/**
 * Fastify plugin that mounts a ts-kizuna API.
 *
 * @example
 * const app = Fastify();
 * await api.mount(app);
 */
const fastifyKizuna = fastifyPlugin(
    async (app: FastifyInstance, options: KizunaPluginOptions) => {
        const { api } = options;
        const guards = api[GUARDS_META] as GuardMap<FastifyHandlerContext> | undefined;
        const schemes = api[SCHEMES_META] as Record<string, SecurityScheme> | undefined;
        const requestContext = api[REQUEST_CONTEXT_META] as RequestContextMap<FastifyHandlerContext> | undefined;

        const pluginExports = pluginExportsOf(api);

        const mountLane = (lane: Routes, resolvedRouter: CoreRouter<Routes, FastifyHandlerContext>): void => {
            // Fastify's auto-exposed HEAD collides with a declared one, but it skips paths that already have HEAD.
            const declaredRoutes = [...adapter.eachRoute(lane, resolvedRouter)].sort(
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
                            routes: lane,
                            router: resolvedRouter,
                            request: adapterRequest,
                            responseContext: {
                                reply,
                                formatError: options?.formatError,
                            },
                            guards,
                            schemes,
                            requestContext,
                            pluginExports,
                            responseValidation: options?.responseValidation,
                        });
                    },
                });
            }
        };

        mountLane(api.routes, api[ROUTER_META] as CoreRouter<Routes, FastifyHandlerContext>);
        mountLane(pluginRoutesOf(api), pluginRouterOf(api) as CoreRouter<Routes, FastifyHandlerContext>);
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
    Plugins extends ContractPlugins,
> = Contract<R, Record<string, TagOptions>, string, Schemes, Auth, RequestContext, Plugins>;

export interface Server<
    R extends Routes,
    Schemes extends Record<string, SecurityScheme>,
    Auth,
    RequestContext extends Record<string, RequestContextSchema>,
    Plugins extends ContractPlugins,
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
        <const GroupOrRoutes extends Extract<keyof Router<ServerContract<R, Schemes, Auth, RequestContext, Plugins>>, string> | Routes>(
            group: GroupOrRoutes,
            router: GroupRouter<ServerContract<R, Schemes, Auth, RequestContext, Plugins>, GroupOrRoutes>
        ): GroupRouter<ServerContract<R, Schemes, Auth, RequestContext, Plugins>, GroupOrRoutes>;
        (
            router: Router<ServerContract<R, Schemes, Auth, RequestContext, Plugins>>
        ): Router<ServerContract<R, Schemes, Auth, RequestContext, Plugins>>;
    };
}

/**
 * What a {@link KizunaApi} is assembled from: the contract it serves, the router
 * that implements it, one guard per declared identity, one resolver per declared
 * request context, and each plugin's live config.
 */
export type ApiConfig<
    R extends Routes,
    Schemes extends Record<string, SecurityScheme>,
    Auth,
    RequestContext extends Record<string, RequestContextSchema>,
    Plugins extends ContractPlugins,
> = {
    contract: ServerContract<R, Schemes, Auth, RequestContext, Plugins>;
    router: Router<ServerContract<R, Schemes, Auth, RequestContext, Plugins>>;
    plugins?: PluginConfigs<Plugins>;
} & (string extends keyof Schemes ? { guards?: undefined } : { guards: NoInfer<GuardsForSchemes<Schemes>> }) &
    (string extends keyof RequestContext
        ? { requestContext?: undefined }
        : { requestContext: NoInfer<{ [Name in keyof RequestContext]: RequestContextRun<FastifyHandlerContext> }> });

const createServerSurface = <
    const R extends Routes,
    Schemes extends Record<string, SecurityScheme>,
    Auth,
    RequestContext extends Record<string, RequestContextSchema>,
    Plugins extends ContractPlugins,
>(
    contract: ServerContract<R, Schemes, Auth, RequestContext, Plugins>
): Server<R, Schemes, Auth, RequestContext, Plugins> => {
    const server = {
        plugins: new Proxy(
            {},
            {
                get: (_target, pluginKey: string) => (config: unknown) =>
                    (contract.plugins as ContractPlugins | undefined)?.[pluginKey]?.server(config as never, undefined),
            }
        ),
        guard: (_name: string, run: unknown) => run,
        requestContext: (_name: string, run: unknown) => run,
        router: (groupOrRouter: unknown, groupRouter?: unknown) => groupRouter ?? groupOrRouter,
    };
    return server as unknown as Server<R, Schemes, Auth, RequestContext, Plugins>;
};

/**
 * Bind a contract to a server handle: the serving counterpart to `Kizuna`. Keep
 * the instance and use `server.guard` to define guards and `server.router` to
 * bind typed handlers, then assemble them with `new KizunaApi()`.
 *
 * @example
 * const server = new KizunaServer(contract);
 *
 * const requireUser = server.guard('user', ({ bearer, deny }) => {
 *     const session = bearer && sessions.get(bearer.token);
 *     return session ? { userId: session.userId } : deny(401, 'Unauthorized');
 * });
 */
export class KizunaServer<
    const R extends Routes,
    Schemes extends Record<string, SecurityScheme>,
    Auth,
    RequestContext extends Record<string, RequestContextSchema>,
    Plugins extends ContractPlugins,
> implements Server<R, Schemes, Auth, RequestContext, Plugins> {
    declare readonly guard: Server<R, Schemes, Auth, RequestContext, Plugins>['guard'];
    declare readonly requestContext: Server<R, Schemes, Auth, RequestContext, Plugins>['requestContext'];
    declare readonly router: Server<R, Schemes, Auth, RequestContext, Plugins>['router'];

    constructor(contract: ServerContract<R, Schemes, Auth, RequestContext, Plugins>) {
        Object.assign(this, createServerSurface(contract));
    }
}

/**
 * Assemble a contract, its router, its guards and its request context resolvers
 * into the api object Fastify registers.
 *
 * @example
 * export const api = new KizunaApi({
 *     contract,
 *     router,
 *     guards: {
 *         user: requireUser,
 *     },
 * });
 *
 * await api.mount(app);
 */
export class KizunaApi<
    const R extends Routes,
    Schemes extends Record<string, SecurityScheme>,
    Auth,
    RequestContext extends Record<string, RequestContextSchema>,
    Plugins extends ContractPlugins,
> implements FastifyApi<R> {
    declare readonly [API_META]: true;
    declare readonly [ROUTER_META]: Record<string, unknown>;
    declare readonly routes: R;
    declare readonly mount: FastifyApi<R>['mount'];
    declare readonly plugin: FastifyApi<R>['plugin'];

    constructor(config: ApiConfig<R, Schemes, Auth, RequestContext, Plugins>) {
        const { contract, ...parts } = config;
        const api = assembleApi(contract, parts as ApiParts) as FastifyApi<R>;
        const plugin = fastifyPlugin(
            async (app: FastifyInstance, pluginOptions: FastifyOptions) => {
                await fastifyKizuna(app, { ...pluginOptions, api });
            },
            {
                name: '@ts-kizuna/fastify',
            }
        );
        return Object.assign(api, {
            plugin,
            mount: async (app: FastifyInstance, mountOptions?: FastifyOptions) => {
                await app.register(plugin, mountOptions ?? {});
            },
        }) as KizunaApi<R, Schemes, Auth, RequestContext, Plugins>;
    }
}
