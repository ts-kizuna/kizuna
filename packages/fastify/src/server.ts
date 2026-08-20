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
    ROUTER_META,
    GUARDS_META,
    SCHEMES_META,
    REQUEST_CONTEXT_META,
    JOBS_META,
    RECEIVERS_META,
    warnUnsupportedJobOptions,
    type ServerOptions,
    type JobsMeta,
    pluginRoutesOf,
    pluginExportsOf,
    type PluginImplementations,
    type PluginArgs,
    pluginRouterOf,
    assembleApi,
    createAdapter,
    renderJsonResult,
    jobRoutes,
    jobRouter,
    jobRunnerFrom,
    receiverRoutes,
    receiverRouter,
    warnUnimplementedReceivers,
    type ReceiversMeta,
    type ReceiverImplementation,
    type ReceiverImplementations,
    type ReceiverVerify,
} from '@ts-kizuna/core/adapter';
import type { z } from 'zod';
import type {
    Contract,
    RoutesOf,
    SchemesOf,
    AuthOf,
    RequestContextOf,
    ContractPluginsOf,
    JobsOf,
    ReceiversOf,
    SecurityScheme,
    GuardSuccess,
    CredentialOf,
    JobHandlers,
    JobsArg,
    RequestContextSchema,
    RequestContextHeaderValues,
} from '@ts-kizuna/core';
import type { HandlersFromAuth, GuardParams, RequestContextValues } from '@ts-kizuna/core/adapter';

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
export type Router<C> = C extends Contract
    ? HandlersFromAuth<
          RoutesOf<C>,
          FastifyHandlerContext & RequestContextValues<RequestContextOf<C>> & PluginArgs<ContractPluginsOf<C>> & JobsArg<JobsOf<C>>,
          SchemesOf<C>,
          AuthOf<C>
      >
    : C extends Routes
      ? CoreRouter<C, FastifyHandlerContext>
      : never;

/**
 * The handler for each of a contract's scheduled jobs, typed against it. Each
 * receives only the job's `input`, so the same handler can be run in process.
 */
export type JobsRouter<C> = C extends Contract ? JobHandlers<JobsOf<C>> : never;

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

export interface Server<C extends Contract> {
    /**
     * Define a guard for one of the contract's identities. It runs before the
     * handlers of every route whose `auth` entry requires the identity, and
     * receives the credential its method extracted (`bearer`, `apiKey`, or
     * `basic`, `null` when absent). Return the identity's context and access
     * fields to allow the request, or call `deny(status, detail)`.
     */
    guard<const Name extends Extract<keyof SchemesOf<C>, string>>(
        name: Name,
        run: GuardFns<SchemesOf<C>, GuardParams<RoutesOf<C>, AuthOf<C>, Name>>[Name]
    ): GuardRun<FastifyHandlerContext>;
    /**
     * Define a request context resolver declared on the contract. It runs on
     * every route, public ones included, and never denies.
     */
    requestContext<const Name extends Extract<keyof RequestContextOf<C>, string>>(
        name: Name,
        run: RequestResolverFns<RequestContextOf<C>>[Name]
    ): RequestContextRun<FastifyHandlerContext>;
    /**
     * Write typed handlers for the contract or one of its route groups.
     */
    router: {
        <const GroupOrRoutes extends Extract<keyof Router<C>, string> | Routes>(
            group: GroupOrRoutes,
            router: GroupRouter<C, GroupOrRoutes>
        ): GroupRouter<C, GroupOrRoutes>;
        (router: Router<C>): Router<C>;
    };
    /**
     * Write a handler for each of the contract's jobs.
     *
     * Pass a `transport` to say where a queued job goes. Without one, `queue`
     * runs the job in this process and it is lost on a crash.
     *
     * @example
     * export const jobs = server.jobs({
     *     sendDigests: async () => ({
     *         status: 200,
     *         body: {
     *             sent: await sendPendingDigests(),
     *         },
     *     }),
     * });
     */
    jobs(handlers: JobsRouter<C>): JobsRouter<C>;
    /**
     * Implement one of the contract's receivers. The first argument names the
     * contract entry, which is what types `body`.
     *
     * @example
     * export const payments = server.receiver('payments', {
     *     verify: verifyPayments,
     *     handler: async ({ body }) => {
     *         await recordPayment(body.id);
     *     },
     * });
     */
    receiver: {
        <const Name extends Extract<keyof ReceiversOf<C>, string>>(
            name: Name,
            implementation: ReceiverImplementation<ReceiversOf<C>[Name], JobsOf<C>>
        ): ReceiverImplementation<ReceiversOf<C>[Name], JobsOf<C>>;
        /**
         * Type a verifier written in its own file.
         *
         * @example
         * export const verifyPayments = server.receiver.verify('payments', ({ raw, headers, deny }) => {
         *     if (!isDigestValid(raw, headers['x-signature'])) {
         *         deny();
         *     }
         * });
         */
        verify<const Name extends Extract<keyof ReceiversOf<C>, string>>(name: Name, run: ReceiverVerify): ReceiverVerify;
    };
    /**
     * Assemble the router, guards, job handlers, and receivers into the api
     * object.
     */
    api(
        options: {
            router: Router<C>;
        } & (string extends keyof SchemesOf<C> ? { guards?: undefined } : { guards: NoInfer<GuardsForSchemes<SchemesOf<C>>> }) &
            (string extends keyof JobsOf<C> ? { jobs?: undefined } : { jobs: NoInfer<JobsRouter<C>> }) &
            (string extends keyof RequestContextOf<C>
                ? { requestContext?: undefined }
                : { requestContext: NoInfer<{ [Name in keyof RequestContextOf<C>]: RequestContextRun<FastifyHandlerContext> }> }) &
            (string extends keyof ReceiversOf<C>
                ? { receivers?: undefined }
                : { receivers: NoInfer<ReceiverImplementations<ReceiversOf<C>, JobsOf<C>>> }) &
            (string extends keyof ContractPluginsOf<C>
                ? { plugins?: undefined }
                : { plugins: PluginImplementations<ContractPluginsOf<C>, FastifyHandlerContext> })
    ): FastifyApi<RoutesOf<C>>;
}

const createServerSurface = <C extends Contract>(contract: C, options?: ServerOptions): Server<C> => {
    warnUnsupportedJobOptions(contract.jobs, options?.jobTransport);
    const server = {
        guard: (_name: string, run: unknown) => run,
        requestContext: (_name: string, run: unknown) => run,
        router: (groupOrRouter: unknown, groupRouter?: unknown) => groupRouter ?? groupOrRouter,
        jobs: (handlers: unknown) => handlers,
        receiver: Object.assign((_name: string, implementation: unknown) => implementation, {
            verify: (_name: string, run: unknown) => run,
        }),
        api: ({
            jobs,
            receivers,
            ...parts
        }: ApiParts & { jobs?: Record<string, unknown>; receivers?: ReceiversMeta['implementations'] }) => {
            if (contract.receivers) {
                warnUnimplementedReceivers(contract.receivers, receivers ?? {});
            }
            const api = Object.assign(assembleApi(contract, parts), {
                [JOBS_META]: contract.jobs
                    ? {
                          jobs: contract.jobs,
                          handlers: jobs ?? {},
                          config: contract.jobsConfig,
                          transport: options?.jobTransport,
                          onError: options?.onJobError,
                      }
                    : undefined,
                [RECEIVERS_META]: contract.receivers
                    ? {
                          receivers: contract.receivers,
                          implementations: receivers ?? {},
                          onError: options?.onReceiverError,
                      }
                    : undefined,
            }) as FastifyApi<RoutesOf<C>>;
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
        },
    };
    return server as unknown as Server<C>;
};

/**
 * Turn a contract into a server handle: the serving counterpart to `Kizuna`.
 * Keep the instance and use `server.guard` to define guards, `server.router`
 * to write typed handlers, and `server.api` to assemble them.
 *
 * @example
 * const server = new KizunaServer(contract);
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
export class KizunaServer<C extends Contract> implements Server<C> {
    declare readonly guard: Server<C>['guard'];
    declare readonly requestContext: Server<C>['requestContext'];
    declare readonly router: Server<C>['router'];
    declare readonly jobs: Server<C>['jobs'];
    declare readonly receiver: Server<C>['receiver'];
    declare readonly api: Server<C>['api'];

    constructor(contract: C, options?: ServerOptions) {
        Object.assign(this, createServerSurface(contract, options));
    }
}
