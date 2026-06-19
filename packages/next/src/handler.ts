import type { z } from 'zod';
import {
    type AdapterRequest,
    type AdapterResult,
    type RouteDefinition,
    type Routes,
    type MiddlewareMap,
    type RouteHandler as CoreRouteHandler,
    type Router as CoreRouter,
    type ErrorFormatter,
    type GuardDenial,
    type GuardErrorBody,
    type ErrorMode,
    createAdapter,
    resolveMiddleware,
    headersToObject,
    matchRoute,
    parseFetchBody,
    renderJsonResult,
    renderGuardDenial,
    guardDenial,
    isGuardDenial,
    usesProblemDetails,
} from '@ts-kizuna/core/adapter';
import type { Contract, TagOptions } from '@ts-kizuna/core';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * The routes type carried by a contract `C`.
 */
export type ContractRoutes<C> = C extends Contract<infer R, infer _Tags, infer _Codes, infer _Mode, infer _GuardError> ? R : never;

/**
 * The `deny(status, body)` body type for a guard bound to contract `C`, from its
 * `guardErrorSchema` and error mode. See {@link GuardErrorBody}.
 */
type DenyBody<C> =
    C extends Contract<infer _R, infer _Tags, infer _Codes, infer Mode, infer GuardError> ? GuardErrorBody<GuardError, Mode> : unknown;

/**
 * Constraint that accepts any contract regardless of error mode or guard schema. The bare
 * `Contract` default (Problem Details, no guard schema) would reject opted-out contracts.
 */
type AnyContract = Contract<Routes, Record<string, TagOptions>, string, ErrorMode, z.ZodType | undefined>;

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
    C extends Contract<infer R, infer _Tags, infer _Codes, infer Mode, infer _GuardError>
        ? CoreRouter<R, NextHandlerContext, Mode>
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
export const createMiddleware = <const C extends AnyContract>(
    _contract: C,
    map: MiddlewareMap<ContractRoutes<C>, NextMiddlewareHandler>
): MiddlewareMap<ContractRoutes<C>, NextMiddlewareHandler> => map;

/**
 * Rejects a request from inside a guard. `deny(status, detail)` is shorthand for a
 * Problem Details body; `deny(status, body)` sends a custom body (typed from the
 * contract's `guardErrorSchema`).
 */
interface Deny<Body = unknown> {
    (status: number, detail: string): GuardDenial;
    (status: number, body: Body): GuardDenial;
}

type GuardFn<Body> = (args: {
    request: NextRequest;
    route: NextMiddlewareRoute;
    deny: Deny<Body>;
}) => Promise<GuardDenial | Response | void> | GuardDenial | Response | void;

/**
 * Create a guard — a middleware that checks access before the handler runs. Call
 * `deny(...)` to reject the request; return without calling it to allow.
 *
 * Pass the contract first (`createGuard(contract, fn)`) to type `deny`'s body against the
 * contract's `guardErrorSchema` and render denials in the contract's error mode.
 *
 * @example
 * const requireAdmin = createGuard(contract, async ({ request, deny }) => {
 *     if (request.headers.get('x-role') !== 'admin') return deny(403, 'Forbidden');
 * });
 */
export function createGuard(guard: GuardFn<unknown>): NextMiddlewareHandler;
export function createGuard<const C extends AnyContract>(contract: C, guard: GuardFn<DenyBody<C>>): NextMiddlewareHandler;
export function createGuard(contractOrGuard: Contract | GuardFn<unknown>, maybeGuard?: GuardFn<unknown>): NextMiddlewareHandler {
    const contract = typeof contractOrGuard === 'function' ? undefined : contractOrGuard;
    const guard = (typeof contractOrGuard === 'function' ? contractOrGuard : maybeGuard) as GuardFn<unknown>;
    const useProblemDetails = contract ? usesProblemDetails(contract.routes) : true;
    const deny = ((status: number, bodyOrDetail: unknown) => guardDenial(status, bodyOrDetail)) as Deny<unknown>;
    return async (request, route) => {
        const result = await guard({ request, route, deny });
        if (isGuardDenial(result)) {
            const rendered = renderGuardDenial(result, useProblemDetails);
            const body = rendered.raw ? (rendered.body as BodyInit) : JSON.stringify(rendered.body);
            return new Response(body, {
                status: rendered.status,
                headers: rendered.headers,
            });
        }
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
