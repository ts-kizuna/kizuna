import {
    type AdapterRequest,
    type AdapterResult,
    type RouteDefinition,
    type Routes,
    type RouteHandler as CoreRouteHandler,
    type Router as CoreRouter,
    type ErrorFormatter,
    type GuardMap,
    type GuardRun,
    type GuardDeny,
    type GuardDenial,
    type RequestContextMap,
    type RequestContextRun,
    type ApiParts,
    type ApiWithRouter,
    assembleApi,
    createAdapter,
    headersToObject,
    matchRoute,
    parseFetchBody,
    renderJsonResult,
    type Jobs,
    type JobRunner,
    ROUTER_META,
    GUARDS_META,
    SCHEMES_META,
    REQUEST_CONTEXT_META,
    JOBS_META,
    warnUnsupportedJobOptions,
    type ServerOptions,
    type JobsMeta,
    jobRoutes,
    jobRouter,
    jobRunnerFrom,
    pluginRoutesOf,
    pluginExportsOf,
    type PluginImplementations,
    type PluginArgs,
    type ContractPlugins,
    pluginRouterOf,
} from '@ts-kizuna/shared/adapter';
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
} from '@ts-kizuna/shared';
import type { HandlersFromAuth, GuardParams, RequestContextValues } from '@ts-kizuna/shared/adapter';
import { type NextRequest, NextResponse } from 'next/server';

export { NextRequest, NextResponse } from 'next/server';

export interface NextHandlerContext {
    request: NextRequest;
}

/**
 * The handler type for a single route, typed against its contract definition.
 */
export type RouteHandler<R extends RouteDefinition> = CoreRouteHandler<R, NextHandlerContext>;

/**
 * The handler tree for a contract, typed against it. Routes secured by the
 * contract's `auth` map additionally receive each required identity's context
 * in their handler args, under `auth`, keyed by the identity's name.
 */
export type Router<C> =
    C extends Contract<infer R, infer _Tags, infer _Codes, infer Schemes, infer Auth, infer RequestContext, infer Plugins, infer J>
        ? HandlersFromAuth<R, NextHandlerContext & RequestContextValues<RequestContext> & PluginArgs<Plugins> & JobsArg<J>, Schemes, Auth>
        : C extends Routes
          ? CoreRouter<C, NextHandlerContext>
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
 * A contract's jobs paired with their handlers, both in the shape the request
 * pipeline takes.
 */
export interface MountedJobs {
    routes: Routes;
    router: CoreRouter<Routes, NextHandlerContext>;
    runner: JobRunner<Jobs>;
}

/**
 * Passed to each middleware function as the second argument.
 */
export interface NextMiddlewareRoute {
    path: string;
    method: string;
}

export type NextMiddlewareHandler = (request: NextRequest, route: NextMiddlewareRoute) => Response | void | Promise<Response | void>;

/**
 * A guard per identity, keyed by name. Each receives the handler context, a
 * `deny` helper, and the matched route's required scopes, and returns that
 * identity's {@link GuardSuccess} (its context and access fields) or a `deny(...)`
 * result. Keying by name lets each guard's return be typed against its own
 * identity, so access values narrow without an annotation. An
 * authentication-only identity (no context, no access) returns nothing on
 * success, or `deny(...)`.
 */
export type GuardFns<Schemes extends Record<string, SecurityScheme>, Params> = {
    [Name in keyof Schemes]: (
        args: NextHandlerContext &
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
export type GuardsForSchemes<Schemes extends Record<string, SecurityScheme>> = {
    [Name in keyof Schemes]: GuardRun<NextHandlerContext>;
};

/**
 * The resolver functions for the request context schemas declared on `kizuna`,
 * keyed by name. Each runs on every route and returns its schema's value.
 */
export type RequestResolverFns<RequestContext extends Record<string, RequestContextSchema>> = {
    [Name in keyof RequestContext]: (
        args: NextHandlerContext & {
            params: Record<string, string>;
            headers: RequestContextHeaderValues<RequestContext[Name]>;
        }
    ) => z.output<RequestContext[Name]['context']> | Promise<z.output<RequestContext[Name]['context']>>;
};

export interface NextHandlerOptions {
    basePath?: string;
    /**
     * Map a thrown error into a response. Return a `NextResponse` (e.g. built
     * from `problemDetails(...)`) to handle the error, or `void` to fall through
     * to the default 500.
     */
    onError?: (error: unknown, request: NextRequest) => NextResponse | Promise<NextResponse> | void | Promise<void>;
    /**
     * Reshape error (status >= 400) response bytes before they are sent. See
     * {@link ErrorFormatter}.
     */
    formatError?: ErrorFormatter<NextRequest>;
    /**
     * Middleware functions that run after route matching but before the handler.
     * Each receives `(request, route)`; return a `Response` to short-circuit.
     * Authentication belongs in a guard.
     */
    requestMiddleware?: Array<NextMiddlewareHandler>;
    /**
     * Validate handler return values against the routes' response schemas.
     * Mismatches surface as 500 errors. Intended for development; disable in
     * production.
     *
     * @default false
     */
    responseValidation?: boolean;
}

const jsonResponse = (status: number, body: unknown, headers: Record<string, string>, raw = false): NextResponse =>
    // Raw bodies (strings or binary Uint8Array) are passed through as `BodyInit`; only JSON is stringified.
    new NextResponse(body === null || body === undefined ? null : raw ? (body as BodyInit) : JSON.stringify(body), {
        status,
        headers,
    });

export const handleNextRequest = async <T extends Routes>(
    request: NextRequest,
    routes: T,
    router: CoreRouter<T, NextHandlerContext>,
    options?: NextHandlerOptions,
    guards?: GuardMap<NextHandlerContext>,
    schemes?: Record<string, SecurityScheme>,
    requestContext?: RequestContextMap<NextHandlerContext>,
    pluginExports?: Record<string, unknown>,
    jobs?: MountedJobs
): Promise<NextResponse> => {
    const url = new URL(request.url);

    const adapter = createAdapter<NextRequest, NextResponse, NextHandlerContext>({
        buildHandlerContext: (adapterRequest) => ({
            request: adapterRequest.request,
        }),
        respond: (result) => {
            if (result.kind === 'raw-response') return result.response as NextResponse;
            const rendered = renderJsonResult(result, options?.formatError as ErrorFormatter, request);
            return jsonResponse(rendered.status, rendered.body, rendered.headers, rendered.raw);
        },
        onError: async (error): Promise<AdapterResult | void> => {
            if (!options?.onError) {
                console.error('[ts-kizuna/next] handler error:', error);
                return;
            }
            const override = await options.onError(error, request);
            if (override) {
                return {
                    kind: 'raw-response',
                    response: override,
                };
            }
        },
    });

    if (jobs) {
        const matchedJob = matchRoute(request.method, url.pathname, jobs.routes, options?.basePath);
        if (matchedJob.kind === 'matched') {
            const jobRequest: AdapterRequest<NextRequest> = {
                request,
                method: request.method,
                resolution: {
                    kind: 'pre-resolved',
                    routeKey: matchedJob.match.routeKey,
                    route: matchedJob.match.route,
                    params: matchedJob.match.params,
                },
                query: Object.fromEntries(url.searchParams),
                headers: headersToObject(request.headers),
                readBody: (route) => parseFetchBody(request, route),
            };
            return adapter.handle({
                routes: jobs.routes,
                router: jobs.router,
                request: jobRequest,
                responseContext: {},
                guards,
                schemes,
                requestContext,
                pluginExports,
                jobs: jobs.runner,
                responseValidation: options?.responseValidation,
            });
        }
    }

    const globalMiddleware = options?.requestMiddleware;

    if (globalMiddleware && globalMiddleware.length > 0) {
        const matched = matchRoute(request.method, url.pathname, routes, options?.basePath);

        if (matched.kind === 'matched') {
            const middlewareRoute: NextMiddlewareRoute = {
                path: matched.match.route.path,
                method: matched.match.route.method,
            };

            for (const handler of globalMiddleware) {
                const result = await handler(request, middlewareRoute);
                if (result instanceof Response) {
                    return new NextResponse(result.body, {
                        status: result.status,
                        statusText: result.statusText,
                        headers: result.headers,
                    });
                }
            }

            const adapterRequest: AdapterRequest<NextRequest> = {
                request,
                method: request.method,
                resolution: {
                    kind: 'pre-resolved',
                    routeKey: matched.match.routeKey,
                    route: matched.match.route,
                    params: matched.match.params,
                },
                query: Object.fromEntries(url.searchParams),
                headers: headersToObject(request.headers),
                readBody: (route) => parseFetchBody(request, route),
            };

            return adapter.handle({
                routes,
                router,
                request: adapterRequest,
                responseContext: {},
                guards,
                schemes,
                requestContext,
                jobs: jobs?.runner,
                responseValidation: options?.responseValidation,
            });
        }
    }

    const adapterRequest: AdapterRequest<NextRequest> = {
        request,
        method: request.method,
        resolution: {
            kind: 'core-match',
            path: url.pathname,
        },
        query: Object.fromEntries(url.searchParams),
        headers: headersToObject(request.headers),
        readBody: (route) => parseFetchBody(request, route),
    };

    return adapter.handle({
        routes,
        router,
        request: adapterRequest,
        responseContext: {},
        guards,
        schemes,
        requestContext,
        pluginExports,
        jobs: jobs?.runner,
        basePath: options?.basePath,
        responseValidation: options?.responseValidation,
    });
};

type HttpHandlers = {
    GET: HttpHandler;
    HEAD: HttpHandler;
    POST: HttpHandler;
    PUT: HttpHandler;
    PATCH: HttpHandler;
    DELETE: HttpHandler;
    OPTIONS: HttpHandler;
};
type HttpHandler = (request: NextRequest) => Promise<NextResponse>;

const _ON_ERROR: unique symbol = Symbol('ts-kizuna.next.onError');

export type NextApiWithRouter = ApiWithRouter & {
    readonly [_ON_ERROR]?: NextHandlerOptions['onError'];
    readonly [GUARDS_META]?: unknown;
    readonly [SCHEMES_META]?: unknown;
    readonly [REQUEST_CONTEXT_META]?: unknown;
    readonly [JOBS_META]?: unknown;
};

export type NextApi<R extends Routes = Routes> = ApiWithRouter<R> & {
    readonly [_ON_ERROR]?: NextHandlerOptions['onError'];
    readonly [GUARDS_META]?: unknown;
    readonly [SCHEMES_META]?: unknown;
    readonly [REQUEST_CONTEXT_META]?: unknown;
    readonly [JOBS_META]?: unknown;
    mount: (options?: NextHandlerOptions) => HttpHandlers;
};

/**
 * Create endpoints for a Next.js App Router catch-all route.
 *
 * @example
 * // app/api/[...ts-kizuna]/route.ts
 * export const { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS } = api.mount({
 *     basePath: '/api',
 * });
 */
export function mountNext(api: NextApiWithRouter, options?: NextHandlerOptions): HttpHandlers {
    const guards = api[GUARDS_META] as GuardMap<NextHandlerContext> | undefined;
    const schemes = api[SCHEMES_META] as Record<string, SecurityScheme> | undefined;
    const requestContext = api[REQUEST_CONTEXT_META] as RequestContextMap<NextHandlerContext> | undefined;
    const jobsMeta = api[JOBS_META] as JobsMeta | undefined;
    const mountedJobs = jobsMeta
        ? {
              routes: jobRoutes(jobsMeta),
              router: jobRouter<NextHandlerContext>(jobsMeta),
              runner: jobRunnerFrom(jobsMeta)!,
          }
        : undefined;
    const handlerOptions = {
        basePath: options?.basePath,
        onError: options?.onError ?? api[_ON_ERROR],
        requestMiddleware: options?.requestMiddleware,
        responseValidation: options?.responseValidation,
    };
    const pluginExports = pluginExportsOf(api);
    const pluginRoutes = pluginRoutesOf(api);
    const pluginRouter = pluginRouterOf(api) as CoreRouter<Routes, NextHandlerContext>;

    const hasPluginRoutes = Object.keys(pluginRoutes).length > 0;

    const handler = async (request: NextRequest) => {
        if (hasPluginRoutes) {
            const pathname = new URL(request.url).pathname;
            const claimedByContract = matchRoute(request.method, pathname, api.routes, options?.basePath).kind === 'matched';

            if (!claimedByContract && matchRoute(request.method, pathname, pluginRoutes, options?.basePath).kind === 'matched') {
                return handleNextRequest(
                    request,
                    pluginRoutes,
                    pluginRouter,
                    handlerOptions,
                    guards,
                    schemes,
                    requestContext,
                    pluginExports
                );
            }
        }

        return handleNextRequest(
            request,
            api.routes,
            api[ROUTER_META] as CoreRouter<Routes, NextHandlerContext>,
            handlerOptions,
            guards,
            schemes,
            requestContext,
            pluginExports,
            mountedJobs
        );
    };
    return {
        GET: handler,
        HEAD: handler,
        POST: handler,
        PUT: handler,
        PATCH: handler,
        DELETE: handler,
        OPTIONS: handler,
    };
}

type ServerContract<
    R extends Routes,
    Schemes extends Record<string, SecurityScheme>,
    Auth,
    RequestContext extends Record<string, RequestContextSchema>,
    Plugins extends ContractPlugins,
    J extends Jobs = Jobs,
> = Contract<R, Record<string, TagOptions>, string, Schemes, Auth, RequestContext, Plugins, J>;

/**
 * The handlers for a group named on the contract, or for a bare route group.
 * Both forms resolve through one signature: a second candidate of the same
 * arity costs zero-argument handlers their contextual type.
 */
type GroupRouter<Source, GroupOrRoutes> = GroupOrRoutes extends string
    ? Router<Source>[Extract<GroupOrRoutes, keyof Router<Source>>]
    : Router<GroupOrRoutes>;

export interface Server<
    R extends Routes,
    Schemes extends Record<string, SecurityScheme>,
    Auth,
    RequestContext extends Record<string, RequestContextSchema>,
    Plugins extends ContractPlugins,
    J extends Jobs = Jobs,
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
    ): GuardRun<NextHandlerContext>;
    /**
     * Define a request context resolver declared on the contract. It runs on
     * every route, public ones included, and never denies.
     */
    requestContext<const Name extends Extract<keyof RequestContext, string>>(
        name: Name,
        run: RequestResolverFns<RequestContext>[Name]
    ): RequestContextRun<NextHandlerContext>;
    /**
     * Write typed handlers for the contract or one of its route groups.
     */
    router: {
        <const GroupOrRoutes extends Extract<keyof Router<ServerContract<R, Schemes, Auth, RequestContext, Plugins, J>>, string> | Routes>(
            group: GroupOrRoutes,
            router: GroupRouter<ServerContract<R, Schemes, Auth, RequestContext, Plugins, J>, GroupOrRoutes>
        ): GroupRouter<ServerContract<R, Schemes, Auth, RequestContext, Plugins, J>, GroupOrRoutes>;
        (
            router: Router<ServerContract<R, Schemes, Auth, RequestContext, Plugins, J>>
        ): Router<ServerContract<R, Schemes, Auth, RequestContext, Plugins, J>>;
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
        handlers: JobsRouter<ServerContract<R, Schemes, Auth, RequestContext, Plugins, J>>
    ): JobsRouter<ServerContract<R, Schemes, Auth, RequestContext, Plugins, J>>;
    /**
     * Assemble the router, guards, and job handlers into the api object.
     */
    api(
        options: {
            router: Router<ServerContract<R, Schemes, Auth, RequestContext, Plugins, J>>;
        } & (string extends keyof Schemes ? { guards?: undefined } : { guards: NoInfer<GuardsForSchemes<Schemes>> }) & {
                onError?: NextHandlerOptions['onError'];
            } & (string extends keyof J
                ? { jobs?: undefined }
                : { jobs: NoInfer<JobsRouter<ServerContract<R, Schemes, Auth, RequestContext, Plugins, J>>> }) &
            (string extends keyof RequestContext
                ? { requestContext?: undefined }
                : { requestContext: NoInfer<{ [Name in keyof RequestContext]: RequestContextRun<NextHandlerContext> }> }) &
            (string extends keyof Plugins ? { plugins?: undefined } : { plugins: PluginImplementations<Plugins, NextHandlerContext> })
    ): NextApi<R>;
}

const createServerSurface = <
    const R extends Routes,
    Schemes extends Record<string, SecurityScheme>,
    Auth,
    RequestContext extends Record<string, RequestContextSchema>,
    Plugins extends ContractPlugins,
    J extends Jobs = Jobs,
>(
    contract: ServerContract<R, Schemes, Auth, RequestContext, Plugins, J>,
    options?: ServerOptions
): Server<R, Schemes, Auth, RequestContext, Plugins, J> => {
    warnUnsupportedJobOptions(contract.jobs, options?.jobTransport);
    const server = {
        guard: (_name: string, run: unknown) => run,
        requestContext: (_name: string, run: unknown) => run,
        router: (groupOrRouter: unknown, groupRouter?: unknown) => groupRouter ?? groupOrRouter,
        jobs: (handlers: unknown) => handlers,
        api: ({ onError, jobs, ...parts }: ApiParts & { onError?: NextHandlerOptions['onError']; jobs?: Record<string, unknown> }) =>
            Object.assign(assembleApi(contract, parts), {
                [_ON_ERROR]: onError,
                [JOBS_META]: contract.jobs
                    ? {
                          jobs: contract.jobs,
                          handlers: jobs ?? {},
                          config: contract.jobsConfig,
                          transport: options?.jobTransport,
                          onError: options?.onJobError,
                      }
                    : undefined,
                mount(mountOptions?: NextHandlerOptions) {
                    return mountNext(this as unknown as NextApiWithRouter, mountOptions);
                },
            }),
    };
    return server as unknown as Server<R, Schemes, Auth, RequestContext, Plugins, J>;
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
> implements Server<R, Schemes, Auth, RequestContext, Plugins, J> {
    declare readonly guard: Server<R, Schemes, Auth, RequestContext, Plugins, J>['guard'];
    declare readonly requestContext: Server<R, Schemes, Auth, RequestContext, Plugins, J>['requestContext'];
    declare readonly router: Server<R, Schemes, Auth, RequestContext, Plugins, J>['router'];
    declare readonly jobs: Server<R, Schemes, Auth, RequestContext, Plugins, J>['jobs'];
    declare readonly api: Server<R, Schemes, Auth, RequestContext, Plugins, J>['api'];

    constructor(contract: ServerContract<R, Schemes, Auth, RequestContext, Plugins, J>, options?: ServerOptions) {
        Object.assign(this, createServerSurface(contract, options));
    }
}
