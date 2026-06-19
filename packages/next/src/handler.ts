import {
    type AdapterRequest,
    type AdapterResult,
    type RouteDefinition,
    type Routes,
    type MiddlewareMap,
    type RouteHandler as CoreRouteHandler,
    type Router as CoreRouter,
    type ErrorFormatter,
    createAdapter,
    resolveMiddleware,
    headersToObject,
    matchRoute,
    parseFetchBody,
    renderJsonResult,
    problemDetails,
} from '@ts-kizuna/core/adapter';
import type { Contract, TagOptions } from '@ts-kizuna/core';
import { type NextRequest, NextResponse } from 'next/server';

export interface NextHandlerContext {
    request: NextRequest;
}

/**
 * The handler type for a single route, typed against its contract definition.
 */
export type RouteHandler<R extends RouteDefinition> = CoreRouteHandler<R, NextHandlerContext>;

/**
 * The handler tree for a contract, typed against it.
 */
export type Router<C> =
    C extends Contract<infer R, infer _Tags, infer _Codes>
        ? CoreRouter<R, NextHandlerContext>
        : C extends Routes
          ? CoreRouter<C, NextHandlerContext>
          : never;

/**
 * Passed to each middleware function as the second argument.
 */
export interface NextMiddlewareRoute {
    path: string;
    method: string;
}

export type NextMiddlewareHandler = (request: NextRequest, route: NextMiddlewareRoute) => Response | void | Promise<Response | void>;

/**
 * Declare per-route middleware in the same shape as the contract's routes.
 *
 * @example
 * export const middleware = createMiddleware(contract, {
 *     listUsers: [authenticate],
 *     createUser: [authenticate, adminOnly],
 * });
 */
export const createMiddleware = <const R extends Routes>(
    _contract: Contract<R, Record<string, TagOptions>, string>,
    map: MiddlewareMap<R, NextMiddlewareHandler>
): MiddlewareMap<R, NextMiddlewareHandler> => map;

type Deny = (status: number, detail: string) => Response;

const deny: Deny = (status, detail) =>
    new Response(JSON.stringify(problemDetails(status, detail)), {
        status,
        headers: {
            'content-type': 'application/problem+json',
        },
    });

/**
 * Create a guard — a middleware that checks access before the handler runs. Call
 * `deny(status, detail)` to reject the request; return without calling it to allow.
 *
 * @example
 * const requireAdmin = createGuard(async ({ request, deny }) => {
 *     if (request.headers.get('x-role') !== 'admin') return deny(403, 'Forbidden');
 * });
 */
export function createGuard(
    guard: (args: { request: NextRequest; route: NextMiddlewareRoute; deny: Deny }) => Promise<Response | void> | Response | void
): NextMiddlewareHandler {
    return async (request, route) => {
        const result = await guard({ request, route, deny });
        if (result instanceof Response) {
            return result;
        }
    };
}

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
     *
     * @deprecated Declare per-route middleware via `createMiddleware` and `createApi` instead.
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
    middlewareMap: MiddlewareMap<Routes, NextMiddlewareHandler> | undefined,
    options?: NextHandlerOptions
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

    const globalMiddleware = options?.requestMiddleware;
    const hasMiddleware = middlewareMap || (globalMiddleware && globalMiddleware.length > 0);

    if (hasMiddleware) {
        const matched = matchRoute(request.method, url.pathname, routes, options?.basePath);

        if (matched.kind === 'matched') {
            const middlewareRoute: NextMiddlewareRoute = {
                path: matched.match.route.path,
                method: matched.match.route.method,
            };

            const routeMiddleware = resolveMiddleware(matched.match.routeKey, middlewareMap);
            const allMiddleware = [...routeMiddleware, ...(globalMiddleware ?? [])];

            for (const handler of allMiddleware) {
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
        basePath: options?.basePath,
        responseValidation: options?.responseValidation,
    });
};
