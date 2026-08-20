import {
    type AdapterRequest,
    type AdapterResult,
    type RouteDefinition,
    type Routes,
    type RouteHandler as CoreRouteHandler,
    type Router as CoreRouter,
    type ErrorFormatter,
    type GuardMap,
    type RequestContextMap,
    type ApiWithRouter,
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
    RECEIVERS_META,
    type ServerOptions,
    type JobsMeta,
    jobRoutes,
    receiverRoutes,
    receiverRouter,
    type ReceiversMeta,
    jobRouter,
    jobRunnerFrom,
    createServerSurface,
    type Server as CoreServer,
    type ServerApiOptions,
    type ContractRouter,
    type ContractJobsRouter,
    pluginRoutesOf,
    pluginExportsOf,
    pluginRouterOf,
} from '@ts-kizuna/core/adapter';
import type { Contract, RoutesOf, SecurityScheme } from '@ts-kizuna/core';
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
export type Router<C> = ContractRouter<C, NextHandlerContext>;

/**
 * The handler for each of a contract's scheduled jobs, typed against it. Each
 * receives only the job's `input`, so the same handler can be run in process.
 */
export type JobsRouter<C> = ContractJobsRouter<C>;

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
                    path: url.pathname,
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
    readonly [RECEIVERS_META]?: unknown;
};

export type NextApi<R extends Routes = Routes> = ApiWithRouter<R> & {
    readonly [_ON_ERROR]?: NextHandlerOptions['onError'];
    readonly [GUARDS_META]?: unknown;
    readonly [SCHEMES_META]?: unknown;
    readonly [REQUEST_CONTEXT_META]?: unknown;
    readonly [JOBS_META]?: unknown;
    readonly [RECEIVERS_META]?: unknown;
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

    const receiversMeta = api[RECEIVERS_META] as ReceiversMeta | undefined;
    const mountedReceivers = receiversMeta
        ? {
              routes: receiverRoutes(receiversMeta),
              router: receiverRouter<NextHandlerContext>(receiversMeta),
          }
        : undefined;

    const hasPluginRoutes = Object.keys(pluginRoutes).length > 0;

    const handler = async (request: NextRequest) => {
        if (mountedReceivers) {
            const pathname = new URL(request.url).pathname;
            if (matchRoute(request.method, pathname, mountedReceivers.routes, options?.basePath).kind === 'matched') {
                return handleNextRequest(
                    request,
                    mountedReceivers.routes,
                    mountedReceivers.router,
                    handlerOptions,
                    guards,
                    schemes,
                    requestContext,
                    pluginExports,
                    mountedJobs
                );
            }
        }

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

export interface Server<C extends Contract> extends CoreServer<C, NextHandlerContext, NextApi<RoutesOf<C>>> {
    /**
     * Next answers with its own error responses, so `api` also takes `onError`.
     */
    api(options: ServerApiOptions<C, NextHandlerContext> & { onError?: NextHandlerOptions['onError'] }): NextApi<RoutesOf<C>>;
}

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
            createServerSurface<C, NextHandlerContext, NextApi<RoutesOf<C>>>(contract, options, (assembled, { onError }) => {
                const api = assembled as NextApi<RoutesOf<C>>;
                return Object.assign(api, {
                    [_ON_ERROR]: onError as NextHandlerOptions['onError'],
                    mount(mountOptions?: NextHandlerOptions) {
                        return mountNext(this as unknown as NextApiWithRouter, mountOptions);
                    },
                });
            })
        );
    }
}
