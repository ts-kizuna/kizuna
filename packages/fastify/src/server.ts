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
    type RequestContextMap,
    ROUTER_META,
    GUARDS_META,
    SCHEMES_META,
    REQUEST_CONTEXT_META,
    JOBS_META,
    RECEIVERS_META,
    type ServerOptions,
    type JobsMeta,
    pluginRoutesOf,
    pluginExportsOf,
    pluginRouterOf,
    createAdapter,
    renderJsonResult,
    jobRoutes,
    jobRouter,
    jobRunnerFrom,
    createServerSurface,
    type Server as CoreServer,
    type ContractRouter,
    type ContractJobsRouter,
    receiverRoutes,
    receiverRouter,
    type ReceiversMeta,
} from '@ts-kizuna/core/adapter';
import type { Contract, RoutesOf, SecurityScheme, GuardSuccess } from '@ts-kizuna/core';

export type FastifyApi<R extends Routes = Routes> = ApiWithRouter<R> & {
    readonly [GUARDS_META]?: unknown;
    readonly [SCHEMES_META]?: unknown;
    readonly [REQUEST_CONTEXT_META]?: unknown;
    readonly [JOBS_META]?: unknown;
    readonly [RECEIVERS_META]?: unknown;
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
export type Router<C> = ContractRouter<C, FastifyHandlerContext>;

/**
 * The handler for each of a contract's scheduled jobs, typed against it. Each
 * receives only the job's `input`, so the same handler can be run in process.
 */
export type JobsRouter<C> = ContractJobsRouter<C>;

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

/**
 * One guard per identity declared on the contract.
 */

/**
 * The resolver functions for the request context schemas declared on `kizuna`,
 * keyed by name. Each runs on every route and returns its schema's value.
 */

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
            // Strings go out as-is; binary (Uint8Array/Buffer) is sent as bytes, never JSON-serialized.
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
 * await api.mount(app);
 */
export const fastifyKizuna = fastifyPlugin(
    async (app: FastifyInstance, options: KizunaPluginOptions) => {
        const { api } = options;
        const guards = api[GUARDS_META] as GuardMap<FastifyHandlerContext> | undefined;
        const schemes = api[SCHEMES_META] as Record<string, SecurityScheme> | undefined;
        const requestContext = api[REQUEST_CONTEXT_META] as RequestContextMap<FastifyHandlerContext> | undefined;

        const pluginExports = pluginExportsOf(api);
        const jobsMeta = api[JOBS_META] as JobsMeta | undefined;
        const jobRunner = jobRunnerFrom(jobsMeta);
        const receiversMeta = api[RECEIVERS_META] as ReceiversMeta | undefined;

        const mountRoute = (
            routeKey: string,
            route: RouteDefinition,
            lane: Routes,
            resolvedRouter: CoreRouter<Routes, FastifyHandlerContext>,
            target: FastifyInstance = app
        ): void => {
            target.route({
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
                            path: request.url.split('?')[0],
                        },
                        query: (request.query ?? {}) as Record<string, string>,
                        headers: request.headers,
                        readBody: () =>
                            route.rawBody
                                ? Buffer.isBuffer(request.body)
                                    ? new Uint8Array(request.body)
                                    : new Uint8Array()
                                : request.body,
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
                        jobs: jobRunner,
                        responseValidation: options?.responseValidation,
                    });
                },
            });
        };

        const mountLane = (lane: Routes, resolvedRouter: CoreRouter<Routes, FastifyHandlerContext>): void => {
            // Fastify's auto-exposed HEAD collides with a declared one, but it skips paths that already have HEAD.
            const declaredRoutes = [...adapter.eachRoute(lane, resolvedRouter)].sort(
                (left, right) => Number(right.route.method === 'HEAD') - Number(left.route.method === 'HEAD')
            );

            for (const { routeKey, route } of declaredRoutes) {
                mountRoute(routeKey, route, lane, resolvedRouter);
            }
        };

        mountLane(api.routes, api[ROUTER_META] as CoreRouter<Routes, FastifyHandlerContext>);
        mountLane(pluginRoutesOf(api), pluginRouterOf(api) as CoreRouter<Routes, FastifyHandlerContext>);

        if (jobsMeta) {
            const routes = jobRoutes(jobsMeta);
            const router = jobRouter<FastifyHandlerContext>(jobsMeta);
            for (const [routeKey, route] of Object.entries(routes)) {
                mountRoute(routeKey, route as RouteDefinition, routes, router);
            }
        }

        // Their own scope, whose only parser keeps the body as bytes. Parsers are
        // encapsulated, so the contract's own routes keep parsing JSON.
        if (receiversMeta) {
            const routes = receiverRoutes(receiversMeta);
            const router = receiverRouter<FastifyHandlerContext>(receiversMeta);
            await app.register(async (scope: FastifyInstance) => {
                scope.removeAllContentTypeParsers();
                scope.addContentTypeParser(
                    '*',
                    {
                        parseAs: 'buffer',
                    },
                    (_request, payload, done) => {
                        done(null, payload);
                    }
                );
                for (const [routeKey, route] of Object.entries(routes)) {
                    mountRoute(routeKey, route as RouteDefinition, routes, router, scope);
                }
            });
        }
    },
    {
        name: '@ts-kizuna/fastify',
    }
);

export interface Server<C extends Contract> extends CoreServer<C, FastifyHandlerContext, FastifyApi<RoutesOf<C>>> {}

/**
 * Turn a contract into a server handle: the serving counterpart to `Kizuna`.
 * Keep the instance and use `server.guard` to define guards, `server.router`
 * to write typed handlers, and `server.api` to assemble them.
 */
export class KizunaServer<C extends Contract> implements Server<C> {
    declare readonly guard: Server<C>['guard'];
    declare readonly requestContext: Server<C>['requestContext'];
    declare readonly router: Server<C>['router'];
    declare readonly jobs: Server<C>['jobs'];
    declare readonly receiver: Server<C>['receiver'];
    declare readonly api: Server<C>['api'];

    constructor(contract: C, options?: ServerOptions) {
        Object.assign(
            this,
            createServerSurface<C, FastifyHandlerContext, FastifyApi<RoutesOf<C>>>(contract, options, (assembled) => {
                const api = assembled as FastifyApi<RoutesOf<C>>;
                const plugin = fastifyPlugin(
                    async (app: FastifyInstance, pluginOptions: FastifyOptions) => {
                        await fastifyKizuna(app, { ...pluginOptions, api });
                    },
                    { name: '@ts-kizuna/fastify' }
                );
                return Object.assign(api, {
                    plugin,
                    mount: async (app: FastifyInstance, mountOptions?: FastifyOptions) => {
                        await app.register(plugin, mountOptions ?? {});
                    },
                });
            })
        );
    }
}
