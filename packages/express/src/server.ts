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
    pluginRouterOf,
    assembleApi,
    createAdapter,
    renderJsonResult,
    jobRoutes,
    jobRouter,
    jobRunnerFrom,
    RECEIVERS_META,
    receiverRoutes,
    receiverRouter,
    warnUnimplementedReceivers,
    problemDetails,
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
export type Router<C> = C extends Contract
    ? HandlersFromAuth<
          RoutesOf<C>,
          ExpressHandlerContext & RequestContextValues<RequestContextOf<C>> & PluginArgs<ContractPluginsOf<C>> & JobsArg<JobsOf<C>>,
          SchemesOf<C>,
          AuthOf<C>
      >
    : C extends Routes
      ? CoreRouter<C, ExpressHandlerContext>
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
 * Refuse a raw-body route another parser already consumed: its bytes are gone.
 */
const requireRawBody =
    (path: string, logger: Pick<Console, 'error'>) =>
    (req: Request, res: Response, next: NextFunction): void => {
        if (Buffer.isBuffer(req.body)) {
            next();
            return;
        }
        logger.error(
            `[ts-kizuna] ${path} was read by another body parser before the receiver saw it, ` +
                'so its delivery cannot be verified. Call `api.mount(app)` before installing your body parser.'
        );
        res.status(500).json(problemDetails(500, 'Raw body unavailable'));
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

    const expressRouter = createExpressRouter();

    const mountRoute = (
        routeKey: string,
        route: RouteDefinition,
        routes: Routes,
        router: CoreRouter<Routes, ExpressHandlerContext>,
        target: ExpressRouter = expressRouter
    ): void => {
        const method = route.method.toLowerCase() as 'get' | 'head' | 'post' | 'put' | 'patch' | 'delete' | 'options';
        const parsers = route.rawBody
            ? [
                  expressRaw({
                      type: () => true,
                  }),
                  requireRawBody(route.path, console),
              ]
            : [];
        target[method](
            route.path,
            ...parsers,
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
                        path: req.originalUrl.split('?')[0],
                    },
                    query: req.query,
                    headers: req.headers,
                    readBody: () => (route.rawBody ? new Uint8Array(req.body as Buffer) : req.body),
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

    // Their own router, so it can be hoisted ahead of the app's body parser.
    if (receiversMeta) {
        const routes = receiverRoutes(receiversMeta);
        const router = receiverRouter<ExpressHandlerContext>(receiversMeta);
        const rawRouter = createExpressRouter();
        for (const [routeKey, route] of Object.entries(routes)) {
            mountRoute(routeKey, route as RouteDefinition, routes, router, rawRouter);
        }
        app.use(rawRouter);
        if (!hoistToFrontOfStack(app)) {
            console.warn(
                '[ts-kizuna] Could not place the receiver routes ahead of the app middleware. ' +
                    'Install your body parser after `api.mount(app)` so a verifier still sees the bytes that arrived.'
            );
        }
    }

    app.use(expressRouter);

    return expressRouter;
}

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
    ): GuardRun<ExpressHandlerContext>;
    /**
     * Define a request context resolver declared on the contract. It runs on
     * every route, public ones included, and never denies.
     */
    requestContext<const Name extends Extract<keyof RequestContextOf<C>, string>>(
        name: Name,
        run: RequestResolverFns<RequestContextOf<C>>[Name]
    ): RequestContextRun<ExpressHandlerContext>;
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
                : { requestContext: NoInfer<{ [Name in keyof RequestContextOf<C>]: RequestContextRun<ExpressHandlerContext> }> }) &
            (string extends keyof ReceiversOf<C>
                ? { receivers?: undefined }
                : { receivers: NoInfer<ReceiverImplementations<ReceiversOf<C>, JobsOf<C>>> }) &
            (string extends keyof ContractPluginsOf<C>
                ? { plugins?: undefined }
                : { plugins: PluginImplementations<ContractPluginsOf<C>, ExpressHandlerContext> })
    ): ExpressApi<RoutesOf<C>>;
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
            }) as ExpressApi<RoutesOf<C>>;
            return Object.assign(api, {
                mount: (app: AppLike, mountOptions?: ExpressOptions) => mountExpress(api, app, mountOptions),
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
