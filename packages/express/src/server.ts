import type { Request, Response, NextFunction, Router as ExpressRouter } from 'express';
import { Router as createExpressRouter } from 'express';
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
    PERMISSIONS_META,
    PERMISSIONS_ENDPOINT_META,
    permissionsEndpointRoutes,
    permissionsEndpointRouter,
    type PermissionsMeta,
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
import type {
    HandlersFromAuth,
    GuardParams,
    RequestContextValues,
    CanArg,
    PermissionResult,
    PermissionAuth,
    PermissionAppliesTo,
    Permission,
    PermissionMap,
    PermissionRun,
} from '@ts-kizuna/core/adapter';

export type ExpressApi<R extends Routes = Routes> = ApiWithRouter<R> & {
    readonly [GUARDS_META]?: unknown;
    readonly [PERMISSIONS_META]?: unknown;
    readonly [PERMISSIONS_ENDPOINT_META]?: unknown;
    readonly [SCHEMES_META]?: unknown;
    readonly [REQUEST_CONTEXT_META]?: unknown;
    readonly [JOBS_META]?: unknown;
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
    C extends Contract<
        infer R,
        infer _Tags,
        infer _Codes,
        infer Schemes,
        infer Auth,
        infer RequestContext,
        infer Plugins,
        infer J,
        infer Permissions_
    >
        ? HandlersFromAuth<
              R,
              ExpressHandlerContext & RequestContextValues<RequestContext> & PluginArgs<Plugins> & JobsArg<J> & CanArg<Permissions_>,
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
 * The implementation for each permission declared on the contract, keyed by name.
 * A permission applying to no record returns a boolean; one applying to a record
 * returns a predicate over it.
 */
type PermissionFns<Permissions_ extends Record<string, Permission>, Schemes extends Record<string, SecurityScheme>> = {
    [Name in keyof Permissions_]: (
        args: ExpressHandlerContext & {
            params: Record<string, string>;
            auth: PermissionAuth<Schemes>;
        }
    ) => PermissionResult<PermissionAppliesTo<Permissions_[Name]>> | Promise<PermissionResult<PermissionAppliesTo<Permissions_[Name]>>>;
};

/**
 * One implementation per permission declared on the contract.
 */
type PermissionsForContract<Permissions_ extends Record<string, Permission>> = {
    [Name in keyof Permissions_]: PermissionRun<ExpressHandlerContext>;
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
 * Mount a ts-kizuna API onto an Express app.
 *
 * @example
 * api.mount(app);
 */
export function mountExpress(api: ExpressApi, app: AppLike, options?: ExpressOptions): ExpressRouter {
    const guards = api[GUARDS_META] as GuardMap<ExpressHandlerContext> | undefined;
    const schemes = api[SCHEMES_META] as Record<string, SecurityScheme> | undefined;
    const permissionRuns = api[PERMISSIONS_META] as PermissionMap<ExpressHandlerContext> | undefined;
    const requestContext = api[REQUEST_CONTEXT_META] as RequestContextMap<ExpressHandlerContext> | undefined;

    const pluginExports = pluginExportsOf(api);
    const jobsMeta = api[JOBS_META] as JobsMeta | undefined;
    const jobRunner = jobRunnerFrom(jobsMeta);

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
                    permissions: permissionRuns,
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

    const permissionsMeta = api[PERMISSIONS_ENDPOINT_META] as PermissionsMeta | undefined;
    if (permissionsMeta) {
        const routes = permissionsEndpointRoutes(permissionsMeta);
        const router = permissionsEndpointRouter<ExpressHandlerContext>(permissionsMeta);
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
    Permissions_ extends Record<string, Permission> = Record<string, Permission>,
> = Contract<R, Record<string, TagOptions>, string, Schemes, Auth, RequestContext, Plugins, J, Permissions_>;

export interface Server<
    R extends Routes,
    Schemes extends Record<string, SecurityScheme>,
    Auth,
    RequestContext extends Record<string, RequestContextSchema>,
    Plugins extends ContractPlugins,
    J extends Jobs = Jobs,
    Permissions_ extends Record<string, Permission> = Record<string, Permission>,
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
     * Implement one of the contract's permissions. It runs at most once per
     * request, on first use, and only when a route's `permissions` entry or a
     * handler's `can` asks about it. Return a boolean, or a predicate for a
     * permission that applies to a record; load the caller's grants in the body so
     * the predicate is a cheap test rather than a query per record.
     */
    permission<const Name extends Extract<keyof Permissions_, string>>(
        name: Name,
        run: PermissionFns<Permissions_, Schemes>[Name]
    ): PermissionRun<ExpressHandlerContext>;
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
                | Extract<keyof Router<ServerContract<R, Schemes, Auth, RequestContext, Plugins, J, Permissions_>>, string>
                | Routes,
        >(
            group: GroupOrRoutes,
            router: GroupRouter<ServerContract<R, Schemes, Auth, RequestContext, Plugins, J, Permissions_>, GroupOrRoutes>
        ): GroupRouter<ServerContract<R, Schemes, Auth, RequestContext, Plugins, J, Permissions_>, GroupOrRoutes>;
        (
            router: Router<ServerContract<R, Schemes, Auth, RequestContext, Plugins, J, Permissions_>>
        ): Router<ServerContract<R, Schemes, Auth, RequestContext, Plugins, J, Permissions_>>;
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
        handlers: JobsRouter<ServerContract<R, Schemes, Auth, RequestContext, Plugins, J, Permissions_>>
    ): JobsRouter<ServerContract<R, Schemes, Auth, RequestContext, Plugins, J, Permissions_>>;
    /**
     * Assemble the router, guards, and job handlers into the api object.
     */
    api(
        options: {
            router: Router<ServerContract<R, Schemes, Auth, RequestContext, Plugins, J, Permissions_>>;
        } & (string extends keyof Schemes ? { guards?: undefined } : { guards: NoInfer<GuardsForSchemes<Schemes>> }) &
            (string extends keyof J
                ? { jobs?: undefined }
                : { jobs: NoInfer<JobsRouter<ServerContract<R, Schemes, Auth, RequestContext, Plugins, J, Permissions_>>> }) &
            (string extends keyof RequestContext
                ? { requestContext?: undefined }
                : { requestContext: NoInfer<{ [Name in keyof RequestContext]: RequestContextRun<ExpressHandlerContext> }> }) &
            (string extends keyof Plugins ? { plugins?: undefined } : { plugins: PluginImplementations<Plugins, ExpressHandlerContext> }) &
            (string extends keyof Permissions_
                ? { permissions?: undefined }
                : { permissions: NoInfer<PermissionsForContract<Permissions_>> })
    ): ExpressApi<R>;
}

const createServerSurface = <
    const R extends Routes,
    Schemes extends Record<string, SecurityScheme>,
    Auth,
    RequestContext extends Record<string, RequestContextSchema>,
    Plugins extends ContractPlugins,
    J extends Jobs = Jobs,
    Permissions_ extends Record<string, Permission> = Record<string, Permission>,
>(
    contract: ServerContract<R, Schemes, Auth, RequestContext, Plugins, J, Permissions_>,
    options?: ServerOptions
): Server<R, Schemes, Auth, RequestContext, Plugins, J, Permissions_> => {
    warnUnsupportedJobOptions(contract.jobs, options?.jobTransport);
    const server = {
        guard: (_name: string, run: unknown) => run,
        permission: (_name: string, run: unknown) => run,
        requestContext: (_name: string, run: unknown) => run,
        router: (groupOrRouter: unknown, groupRouter?: unknown) => groupRouter ?? groupOrRouter,
        jobs: (handlers: unknown) => handlers,
        api: ({ jobs, ...parts }: ApiParts & { jobs?: Record<string, unknown> }) => {
            const api = Object.assign(assembleApi(contract, parts), {
                [PERMISSIONS_ENDPOINT_META]:
                    contract.permissionsConfig && contract.declaredPermissions
                        ? {
                              ...contract.permissionsConfig,
                              declared: contract.declaredPermissions,
                          }
                        : undefined,
                [JOBS_META]: contract.jobs
                    ? {
                          jobs: contract.jobs,
                          handlers: jobs ?? {},
                          config: contract.jobsConfig,
                          transport: options?.jobTransport,
                          onError: options?.onJobError,
                      }
                    : undefined,
            }) as ExpressApi<R>;
            return Object.assign(api, {
                mount: (app: AppLike, mountOptions?: ExpressOptions) => mountExpress(api, app, mountOptions),
            });
        },
    };
    return server as unknown as Server<R, Schemes, Auth, RequestContext, Plugins, J, Permissions_>;
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
    Permissions_ extends Record<string, Permission> = Record<string, Permission>,
> implements Server<R, Schemes, Auth, RequestContext, Plugins, J, Permissions_> {
    declare readonly guard: Server<R, Schemes, Auth, RequestContext, Plugins, J, Permissions_>['guard'];
    declare readonly permission: Server<R, Schemes, Auth, RequestContext, Plugins, J, Permissions_>['permission'];
    declare readonly requestContext: Server<R, Schemes, Auth, RequestContext, Plugins, J, Permissions_>['requestContext'];
    declare readonly router: Server<R, Schemes, Auth, RequestContext, Plugins, J, Permissions_>['router'];
    declare readonly jobs: Server<R, Schemes, Auth, RequestContext, Plugins, J, Permissions_>['jobs'];
    declare readonly api: Server<R, Schemes, Auth, RequestContext, Plugins, J, Permissions_>['api'];

    constructor(contract: ServerContract<R, Schemes, Auth, RequestContext, Plugins, J, Permissions_>, options?: ServerOptions) {
        Object.assign(this, createServerSurface(contract, options));
    }
}
