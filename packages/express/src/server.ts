import type { Request, Response, NextFunction, Router as ExpressRouter } from 'express';
import { Router as createExpressRouter, raw as expressRaw } from 'express';
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
    warnUnsupportedJobOptions,
    type ServerOptions,
    type JobsMeta,
    pluginRoutesOf,
    pluginExportsOf,
    type PluginImplementations,
    type PluginArgs,
    type ContractPlugins,
    pluginRouterOf,
    assembleApi,
    createAdapter,
    renderJsonResult,
    jobRoutes,
    jobRouter,
    jobRunnerFrom,
    type Jobs,
    RECEIVERS_META,
    flattenReceivers,
    handleReceiverDelivery,
    warnUnimplementedReceivers,
    type Receivers,
    type ReceiversMeta,
    type ReceiverImplementation,
    type ReceiverImplementations,
    type ReceiverVerify,
} from '@ts-kizuna/core/adapter';
import type { z } from 'zod';
import type {
    Contract,
    TagOptions,
    SecurityScheme,
    GuardSuccess,
    CredentialOf,
    JobHandlers,
    JobsArg,
    RequestContextSchema,
    RequestContextHeaderValues,
} from '@ts-kizuna/core';
import type { HandlersFromAuth, GuardParams, RequestContextValues } from '@ts-kizuna/core/adapter';

export type ExpressApi<R extends Routes = Routes> = ApiWithRouter<R> & {
    readonly [GUARDS_META]?: unknown;
    readonly [SCHEMES_META]?: unknown;
    readonly [REQUEST_CONTEXT_META]?: unknown;
    readonly [JOBS_META]?: unknown;
    readonly [RECEIVERS_META]?: unknown;
    /**
     * Register every contract route on an Express app or router.
     */
    mount: (app: AppLike, options?: ExpressOptions) => ExpressRouter;
};

/**
 * The Express request and response passed to each handler.
 */
export interface ExpressHandlerContext {
    req: Request;
    res: Response;
}

/**
 * The handler for a single route, typed against its contract definition.
 */
export type RouteHandler<R extends RouteDefinition> = CoreRouteHandler<R, ExpressHandlerContext>;

/**
 * The handler tree for a contract or route group, typed against it. Routes
 * secured by the contract's `auth` map additionally receive each required
 * identity's context in their handler args, under `auth`, keyed by the identity's name.
 */
export type Router<C> =
    C extends Contract<infer R, infer _Tags, infer _Codes, infer Schemes, infer Auth, infer RequestContext, infer Plugins, infer J>
        ? HandlersFromAuth<
              R,
              ExpressHandlerContext & RequestContextValues<RequestContext> & PluginArgs<Plugins> & JobsArg<J>,
              Schemes,
              Auth
          >
        : C extends Routes
          ? CoreRouter<C, ExpressHandlerContext>
          : never;

/**
 * The handler for each of a contract's scheduled jobs, typed against it. Each
 * receives only the job's `input`, so the same handler can be run in process.
 */
export type JobsRouter<C> =
    C extends Contract<infer _R, infer _Tags, infer _Codes, infer _Schemes, infer _Auth, infer _RequestContext, infer _Plugins, infer J>
        ? JobHandlers<J>
        : never;

/**
 * The handlers for a group named on the contract, or for a bare route group.
 * Both forms resolve through one signature: a second candidate of the same
 * arity costs zero-argument handlers their contextual type.
 */
type GroupRouter<Source, GroupOrRoutes> = GroupOrRoutes extends string
    ? Router<Source>[Extract<GroupOrRoutes, keyof Router<Source>>]
    : Router<GroupOrRoutes>;

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            kizunaRoute?: RouteDefinition;
        }
    }
}

export interface ExpressOptions {
    /**
     * Validate handler return values against the route's response schemas.
     * Mismatches surface as 500 errors. Enable in development.
     *
     * @default false
     */
    responseValidation?: boolean;
    /**
     * Reshape error (status >= 400) response bytes before they are sent. See
     * {@link ErrorFormatter}.
     */
    formatError?: ErrorFormatter<Request>;
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
        args: ExpressHandlerContext &
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
    [Name in keyof Schemes]: GuardRun<ExpressHandlerContext>;
};

/**
 * The resolver functions for the request context schemas declared on `kizuna`,
 * keyed by name. Each runs on every route and returns its schema's value.
 */
type RequestResolverFns<RequestContext extends Record<string, RequestContextSchema>> = {
    [Name in keyof RequestContext]: (
        args: ExpressHandlerContext & {
            params: Record<string, string>;
            headers: RequestContextHeaderValues<RequestContext[Name]>;
        }
    ) => z.output<RequestContext[Name]['context']> | Promise<z.output<RequestContext[Name]['context']>>;
};

export interface AppLike {
    use: (router: ExpressRouter) => unknown;
}

interface ExpressResponseContext {
    res: Response;
    next: NextFunction;
    formatError?: ErrorFormatter<Request>;
}

/**
 * Write a web `Response` to a node response. Plugins answer in web terms to stay
 * adapter-agnostic, so the translation belongs here.
 */
const writeWebResponse = async (response: unknown, res: Response): Promise<void> => {
    if (!(response instanceof globalThis.Response)) return;
    res.status(response.status);
    response.headers.forEach((value, name) => res.setHeader(name, value));
    if (!response.body) {
        res.end();
        return;
    }
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
};

const adapter = createAdapter<Request, void, ExpressHandlerContext, ExpressResponseContext>({
    buildHandlerContext: (adapterRequest, { res }) => ({
        req: adapterRequest.request,
        res,
    }),
    respond: (result, { res, next, formatError }) => {
        if (result.kind === 'handler-error') {
            next(result.error);
            return;
        }
        if (result.kind === 'raw-response') {
            void writeWebResponse(result.response, res);
            return;
        }
        if (res.headersSent) return;
        if (result.kind === 'not-found' || result.kind === 'method-not-allowed') {
            next();
            return;
        }
        const rendered = renderJsonResult(result, formatError as ErrorFormatter, res.req);
        for (const [key, value] of Object.entries(rendered.headers)) {
            res.setHeader(key, value);
        }
        if (rendered.body === undefined) {
            res.status(rendered.status).end();
        } else if (rendered.raw) {
            const body = rendered.body;
            // Strings go out as-is; binary (Uint8Array/Buffer) is sent as bytes, never JSON-serialized.
            res.status(rendered.status).send(typeof body === 'string' || Buffer.isBuffer(body) ? body : Buffer.from(body as Uint8Array));
        } else {
            res.status(rendered.status).json(rendered.body);
        }
    },
});

/**
 * A verifier checks one string, so a header Express kept as an array is joined
 * the way it arrived.
 */
const flattenHeaders = (headers: Request['headers']): Record<string, string> => {
    const flattened: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
        if (value === undefined) continue;
        flattened[name] = Array.isArray(value) ? value.join(', ') : value;
    }
    return flattened;
};

/**
 * Move the layer just added to the front of the app's middleware stack.
 *
 * Most apps install a body parser before calling `api.mount`, and `app.use` only
 * appends, so the receiver routes have to be hoisted past it or a verifier never
 * sees the bytes the vendor signed.
 */
const hoistToFrontOfStack = (app: AppLike): boolean => {
    const stack = (app as { router?: { stack?: unknown[] } }).router?.stack;
    if (!Array.isArray(stack) || stack.length === 0) return false;
    stack.unshift(stack.pop());
    return true;
};

/**
 * Register one POST route per receiver, reading the body as bytes.
 */
const mountReceivers = (app: AppLike, meta: ReceiversMeta, jobs: unknown, logger: Pick<Console, 'warn' | 'error'> = console): void => {
    const receiverRouter = createExpressRouter();
    for (const { receiverKey, receiver } of flattenReceivers(meta.receivers)) {
        receiverRouter.post(
            receiver.path,
            expressRaw({
                type: () => true,
            }),
            async (req: Request, res: Response) => {
                if (!Buffer.isBuffer(req.body)) {
                    logger.error(
                        `[ts-kizuna] ${receiver.path} was read by another body parser before the receiver saw it, ` +
                            'so its delivery cannot be verified. Call `api.mount(app)` before installing your body parser.'
                    );
                    res.status(500).json({
                        type: 'about:blank',
                        title: 'Internal Server Error',
                        status: 500,
                        detail: 'Raw body unavailable',
                    });
                    return;
                }
                const result = await handleReceiverDelivery(
                    receiverKey,
                    receiver,
                    meta,
                    {
                        method: req.method,
                        path: req.originalUrl.split('?')[0] ?? receiver.path,
                        headers: flattenHeaders(req.headers),
                        body: new Uint8Array(req.body),
                    },
                    jobs
                );
                if (result.body === undefined) {
                    res.status(result.status).end();
                } else {
                    res.status(result.status).json(result.body);
                }
            }
        );
    }
    app.use(receiverRouter);
    if (!hoistToFrontOfStack(app)) {
        logger.warn(
            '[ts-kizuna] Could not place the receiver routes ahead of the app middleware. ' +
                'Install your body parser after `api.mount(app)` so a verifier still sees the bytes that arrived.'
        );
    }
};

/**
 * Mount a ts-kizuna API onto an Express app.
 *
 * @example
 * api.mount(app);
 */
export function mountExpress(api: ExpressApi, app: AppLike, options?: ExpressOptions): ExpressRouter {
    const guards = api[GUARDS_META] as GuardMap<ExpressHandlerContext> | undefined;
    const schemes = api[SCHEMES_META] as Record<string, SecurityScheme> | undefined;
    const requestContext = api[REQUEST_CONTEXT_META] as RequestContextMap<ExpressHandlerContext> | undefined;

    const pluginExports = pluginExportsOf(api);
    const jobsMeta = api[JOBS_META] as JobsMeta | undefined;
    const jobRunner = jobRunnerFrom(jobsMeta);
    const receiversMeta = api[RECEIVERS_META] as ReceiversMeta | undefined;

    if (receiversMeta) {
        mountReceivers(app, receiversMeta, jobRunner);
    }

    const expressRouter = createExpressRouter();

    const mountRoute = (
        routeKey: string,
        route: RouteDefinition,
        routes: Routes,
        router: CoreRouter<Routes, ExpressHandlerContext>
    ): void => {
        const method = route.method.toLowerCase() as 'get' | 'head' | 'post' | 'put' | 'patch' | 'delete' | 'options';
        expressRouter[method](
            route.path,
            (req: Request, _res: Response, next: NextFunction) => {
                req.kizunaRoute = route;
                next();
            },
            async (req: Request, res: Response, next: NextFunction) => {
                const adapterRequest: AdapterRequest<Request> = {
                    request: req,
                    method: req.method,
                    resolution: {
                        kind: 'pre-resolved',
                        routeKey,
                        route,
                        params: req.params as Record<string, string>,
                    },
                    query: req.query,
                    headers: req.headers,
                    readBody: () => req.body,
                };
                await adapter.handle({
                    routes,
                    router,
                    request: adapterRequest,
                    responseContext: {
                        res,
                        next,
                        formatError: options?.formatError,
                    },
                    guards,
                    schemes,
                    requestContext,
                    pluginExports,
                    jobs: jobRunner,
                    responseValidation: options?.responseValidation,
                });
            }
        );
    };

    const mountLane = (routes: Routes, router: CoreRouter<Routes, ExpressHandlerContext>): void => {
        for (const { routeKey, route } of adapter.eachRoute(routes, router)) {
            mountRoute(routeKey, route, routes, router);
        }
    };

    mountLane(api.routes, api[ROUTER_META] as CoreRouter<Routes, ExpressHandlerContext>);
    mountLane(pluginRoutesOf(api), pluginRouterOf(api) as CoreRouter<Routes, ExpressHandlerContext>);

    if (jobsMeta) {
        const routes = jobRoutes(jobsMeta);
        const router = jobRouter<ExpressHandlerContext>(jobsMeta);
        for (const [routeKey, route] of Object.entries(routes)) {
            mountRoute(routeKey, route as RouteDefinition, routes, router);
        }
    }

    app.use(expressRouter);

    return expressRouter;
}

type ServerContract<
    R extends Routes,
    Schemes extends Record<string, SecurityScheme>,
    Auth,
    RequestContext extends Record<string, RequestContextSchema>,
    Plugins extends ContractPlugins,
    J extends Jobs = Jobs,
    Rec extends Receivers = Receivers,
> = Contract<R, Record<string, TagOptions>, string, Schemes, Auth, RequestContext, Plugins, J, Rec>;

export interface Server<
    R extends Routes,
    Schemes extends Record<string, SecurityScheme>,
    Auth,
    RequestContext extends Record<string, RequestContextSchema>,
    Plugins extends ContractPlugins,
    J extends Jobs = Jobs,
    Rec extends Receivers = Receivers,
> {
    /**
     * Define a guard for one of the contract's identities. It runs before the
     * handlers of every route whose `auth` entry requires the identity, and
     * receives the credential its method extracted (`bearer`, `apiKey`, or
     * `basic`, `null` when absent). Return the identity's context and access
     * fields to allow the request, or call `deny(status, detail)`.
     */
    guard<const Name extends Extract<keyof Schemes, string>>(
        name: Name,
        run: GuardFns<Schemes, GuardParams<R, Auth, Name>>[Name]
    ): GuardRun<ExpressHandlerContext>;
    /**
     * Define a request context resolver declared on the contract. It runs on
     * every route, public ones included, and never denies.
     */
    requestContext<const Name extends Extract<keyof RequestContext, string>>(
        name: Name,
        run: RequestResolverFns<RequestContext>[Name]
    ): RequestContextRun<ExpressHandlerContext>;
    /**
     * Write typed handlers for the contract or one of its route groups.
     */
    router: {
        <
            const GroupOrRoutes extends
                | Extract<keyof Router<ServerContract<R, Schemes, Auth, RequestContext, Plugins, J, Rec>>, string>
                | Routes,
        >(
            group: GroupOrRoutes,
            router: GroupRouter<ServerContract<R, Schemes, Auth, RequestContext, Plugins, J, Rec>, GroupOrRoutes>
        ): GroupRouter<ServerContract<R, Schemes, Auth, RequestContext, Plugins, J, Rec>, GroupOrRoutes>;
        (
            router: Router<ServerContract<R, Schemes, Auth, RequestContext, Plugins, J, Rec>>
        ): Router<ServerContract<R, Schemes, Auth, RequestContext, Plugins, J, Rec>>;
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
    jobs(
        handlers: JobsRouter<ServerContract<R, Schemes, Auth, RequestContext, Plugins, J, Rec>>
    ): JobsRouter<ServerContract<R, Schemes, Auth, RequestContext, Plugins, J, Rec>>;
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
        <const Name extends Extract<keyof Rec, string>>(
            name: Name,
            implementation: ReceiverImplementation<Rec[Name], J>
        ): ReceiverImplementation<Rec[Name], J>;
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
        verify<const Name extends Extract<keyof Rec, string>>(name: Name, run: ReceiverVerify): ReceiverVerify;
    };
    /**
     * Assemble the router, guards, job handlers, and receivers into the api
     * object.
     */
    api(
        options: {
            router: Router<ServerContract<R, Schemes, Auth, RequestContext, Plugins, J, Rec>>;
        } & (string extends keyof Schemes ? { guards?: undefined } : { guards: NoInfer<GuardsForSchemes<Schemes>> }) &
            (string extends keyof J
                ? { jobs?: undefined }
                : { jobs: NoInfer<JobsRouter<ServerContract<R, Schemes, Auth, RequestContext, Plugins, J, Rec>>> }) &
            (string extends keyof RequestContext
                ? { requestContext?: undefined }
                : { requestContext: NoInfer<{ [Name in keyof RequestContext]: RequestContextRun<ExpressHandlerContext> }> }) &
            (string extends keyof Rec ? { receivers?: undefined } : { receivers: NoInfer<ReceiverImplementations<Rec, J>> }) &
            (string extends keyof Plugins ? { plugins?: undefined } : { plugins: PluginImplementations<Plugins, ExpressHandlerContext> })
    ): ExpressApi<R>;
}

const createServerSurface = <
    const R extends Routes,
    Schemes extends Record<string, SecurityScheme>,
    Auth,
    RequestContext extends Record<string, RequestContextSchema>,
    Plugins extends ContractPlugins,
    J extends Jobs = Jobs,
    Rec extends Receivers = Receivers,
>(
    contract: ServerContract<R, Schemes, Auth, RequestContext, Plugins, J, Rec>,
    options?: ServerOptions
): Server<R, Schemes, Auth, RequestContext, Plugins, J, Rec> => {
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
            }) as ExpressApi<R>;
            return Object.assign(api, {
                mount: (app: AppLike, mountOptions?: ExpressOptions) => mountExpress(api, app, mountOptions),
            });
        },
    };
    return server as unknown as Server<R, Schemes, Auth, RequestContext, Plugins, J, Rec>;
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
export class KizunaServer<
    const R extends Routes,
    Schemes extends Record<string, SecurityScheme>,
    Auth,
    RequestContext extends Record<string, RequestContextSchema>,
    Plugins extends ContractPlugins,
    J extends Jobs = Jobs,
    Rec extends Receivers = Receivers,
> implements Server<R, Schemes, Auth, RequestContext, Plugins, J, Rec> {
    declare readonly guard: Server<R, Schemes, Auth, RequestContext, Plugins, J, Rec>['guard'];
    declare readonly requestContext: Server<R, Schemes, Auth, RequestContext, Plugins, J, Rec>['requestContext'];
    declare readonly router: Server<R, Schemes, Auth, RequestContext, Plugins, J, Rec>['router'];
    declare readonly jobs: Server<R, Schemes, Auth, RequestContext, Plugins, J, Rec>['jobs'];
    declare readonly receiver: Server<R, Schemes, Auth, RequestContext, Plugins, J, Rec>['receiver'];
    declare readonly api: Server<R, Schemes, Auth, RequestContext, Plugins, J, Rec>['api'];

    constructor(contract: ServerContract<R, Schemes, Auth, RequestContext, Plugins, J, Rec>, options?: ServerOptions) {
        Object.assign(this, createServerSurface(contract, options));
    }
}
