import {
    type AdapterRequest,
    type AdapterResult,
    type RouteDefinition,
    type Contract,
    type MiddlewareMap,
    type RouteHandler as CoreRouteHandler,
    type Router as CoreRouter,
    createAdapter,
    resolveMiddleware,
    headersToObject,
    matchRoute,
    parseFetchBody,
    renderJsonResult,
    problemDetails,
} from '@ts-kizuna/core/adapter';
import { type NextRequest, NextResponse } from 'next/server';

export interface NextHandlerContext {
    request: NextRequest;
}

export type RouteHandler<R extends RouteDefinition> = CoreRouteHandler<R, NextHandlerContext>;
export type Router<T extends Contract> = CoreRouter<T, NextHandlerContext>;

/**
 * Passed to each middleware function as the second argument.
 */
export interface NextMiddlewareRoute {
    path: string;
    method: string;
}

export type NextMiddlewareHandler = (request: NextRequest, route: NextMiddlewareRoute) => Response | void | Promise<Response | void>;

/**
 * Declare per-route middleware in the same shape as the contract.
 *
 * ```ts
 * import { createMiddleware } from '@ts-kizuna/next';
 * import { contract } from './contract';
 *
 * export const middleware = createMiddleware(contract, {
 *     listUsers: [authenticate],
 *     createUser: [authenticate, adminOnly],
 * });
 * ```
 */
export const createMiddleware = <T extends Contract>(
    _contract: T,
    map: MiddlewareMap<T, NextMiddlewareHandler>
): MiddlewareMap<T, NextMiddlewareHandler> => map;

type Deny = (status: number, detail: string) => Response;

const deny: Deny = (status, detail) =>
    new Response(JSON.stringify(problemDetails(status, detail)), {
        status,
        headers: {
            'content-type': 'application/problem+json',
        },
    });

/**
 * Create a guard — a middleware that checks access before the handler runs.
 *
 * Call `deny(status, message)` to reject the request.
 * Return without calling `deny` to allow it through.
 *
 * ```ts
 * import { createGuard } from '@ts-kizuna/next';
 *
 * const requireAdmin = createGuard(async (request, route, deny) => {
 *     if (request.user.role !== 'admin') {
 *         return deny(403, 'Forbidden');
 *     }
 * });
 * ```
 */
export function createGuard(
    guard: (request: NextRequest, route: NextMiddlewareRoute, deny: Deny) => Promise<Response | void> | Response | void
): NextMiddlewareHandler {
    return async (request, route) => {
        const result = await guard(request, route, deny);
        if (result instanceof Response) {
            return result;
        }
    };
}

export interface NextHandlerOptions {
    basePath?: string;
    onError?: (error: unknown, request: NextRequest) => NextResponse | Promise<NextResponse> | void | Promise<void>;
    /**
     * Middleware functions that run after route matching but before the handler.
     *
     * Each function receives `(request, route)`. Return a `Response` to short-circuit
     * (skip remaining middleware and the handler). Return `undefined` to continue.
     * Properties set on `request` (e.g. `request.userId`) are accessible in the handler
     * via `{ request }`.
     *
     * Functions run in order.
     *
     * @deprecated Use `middleware` via `createApi` instead.
     */
    requestMiddleware?: Array<NextMiddlewareHandler>;
    /**
     * Validate handler return values against the contract's response schemas.
     * Mismatches surface as 500 errors. Intended for development; disable in production.
     *
     * @default false
     */
    responseValidation?: boolean;
}

const jsonResponse = (status: number, body: unknown, headers: Record<string, string>): NextResponse =>
    new NextResponse(body === null || body === undefined ? null : JSON.stringify(body), {
        status,
        headers,
    });

export const handleNextRequest = async <T extends Contract>(
    request: NextRequest,
    contract: T,
    router: Router<T>,
    middlewareMap: MiddlewareMap<Contract, NextMiddlewareHandler> | undefined,
    options?: NextHandlerOptions
): Promise<NextResponse> => {
    const url = new URL(request.url);

    const adapter = createAdapter<NextRequest, NextResponse, NextHandlerContext>({
        buildHandlerContext: (adapterRequest) => ({
            request: adapterRequest.request,
        }),
        respond: (result) => {
            if (result.kind === 'raw-response') return result.response as NextResponse;
            const rendered = renderJsonResult(result);
            return jsonResponse(rendered.status, rendered.body, rendered.headers);
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
        const matched = matchRoute(request.method, url.pathname, contract as unknown as Contract, options?.basePath);

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
                contract,
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
        contract,
        router,
        request: adapterRequest,
        responseContext: {},
        basePath: options?.basePath,
        responseValidation: options?.responseValidation,
    });
};
