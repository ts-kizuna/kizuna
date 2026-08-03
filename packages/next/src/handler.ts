import {
    type AdapterRequest,
    type AdapterResult,
    type RouteDefinition,
    type Routes,
    type MiddlewareMap,
    type RouteHandler as CoreRouteHandler,
    type Router as CoreRouter,
    type ErrorFormatter,
    type GuardMap,
    type GuardRun,
    type GuardDeny,
    type GuardDenial,
    type RequestContextMap,
    type RequestContextRun,
    createAdapter,
    headersToObject,
    matchRoute,
    parseFetchBody,
    resolveMiddleware,
    renderJsonResult,
    sseResponseInit,
    reportStreamError,
} from '@ts-kizuna/core/adapter';
import type { z } from 'zod';
import type {
    Contract,
    TagOptions,
    SecurityScheme,
    HandlersFromAuth,
    GuardSuccess,
    CredentialOf,
    GuardParams,
    RequestContextSchema,
    RequestContextHeaderValues,
    RequestContextValues,
} from '@ts-kizuna/core';
import { type NextRequest, NextResponse } from 'next/server';

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
    C extends Contract<infer R, infer _Tags, infer _Codes, infer Schemes, infer Auth, infer RequestContext>
        ? HandlersFromAuth<R, NextHandlerContext & RequestContextValues<RequestContext>, Schemes, Auth>
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
 * Declare per-route middleware in the same shape as the contract's or group's routes.
 *
 * @deprecated Define auth with identities + the contract's `auth` map and pass
 * `guards` to `createApi`. See /docs/auth.
 *
 * @example
 * export const middleware = createMiddleware(contract, {
 *     listUsers: [authenticate],
 *     createUser: [authenticate, adminOnly],
 * });
 */
export const createMiddleware = <const R extends Routes>(
    _source: Contract<R, Record<string, TagOptions>, string> | R,
    map: MiddlewareMap<R, NextMiddlewareHandler>
): MiddlewareMap<R, NextMiddlewareHandler> => map;

/**
 * A guard per identity, keyed by name. Each receives the handler context, a
 * `deny` helper, and the matched route's required scopes, and returns that
 * identity's {@link GuardSuccess} (its context and access fields) or a `deny(...)`
 * result. Keying by name lets each guard's return be typed against its own
 * identity, so access values narrow without an annotation.
 */
export type GuardFns<Schemes extends Record<string, SecurityScheme>, Params> = {
    [Name in keyof Schemes]: (
        args: NextHandlerContext &
            CredentialOf<Schemes[Name]> & {
                params: Params;
                deny: GuardDeny;
                scopes: string[];
            }
    ) => GuardSuccess<Schemes[Name]> | GuardDenial | Promise<GuardSuccess<Schemes[Name]> | GuardDenial>;
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

/**
 * Implement a request context provider declared on `kizuna` under `context`. It
 * runs on every route — public ones included — and never denies; handlers read
 * its value under the provider's name.
 *
 * @deprecated Use `server.requestContext(name, run)` from {@link createServer}. The
 * contract is bound once and the name carries through to `server.api`.
 *
 * @example
 * export const captureAnalytics = createRequestContextResolver(contract, 'analytics', ({ request }) => ({
 *     sessionId: request.headers.get('x-posthog-session-id'),
 * }));
 */
export function createRequestContextResolver<
    RequestContext extends Record<string, RequestContextSchema>,
    const Name extends Extract<keyof RequestContext, string>,
>(
    _contract: Contract<Routes, Record<string, TagOptions>, string, Record<string, SecurityScheme>, unknown, RequestContext>,
    _name: Name,
    run: RequestResolverFns<RequestContext>[Name]
): RequestContextRun<NextHandlerContext> {
    return run as unknown as RequestContextRun<NextHandlerContext>;
}

/**
 * Define a guard for an identity. It runs before the handlers of routes whose
 * `auth` entry requires the identity. The argument carries the request context
 * plus the credential the identity's method extracted (`bearer`, `apiKey`, or
 * `basic` — `null` when absent), a `deny` helper, and the route's `scopes`.
 * Return the identity's context and access fields to allow the request (read in
 * handlers under `auth`, keyed by the identity's name), or call `deny(status, detail)`.
 *
 * @deprecated Use `server.guard(name, run)` from {@link createServer}. The contract
 * is bound once and the identity name carries through to `server.api`.
 *
 * @example
 * export const requireUser = createGuard(contract, 'user', async ({ bearer, deny }) => {
 *     const session = bearer && (await verify(bearer.token));
 *     if (!session) return deny(401, 'Unauthorized');
 *     return {
 *         userId: session.userId,
 *     };
 * });
 */
export function createGuard<
    const R extends Routes,
    Schemes extends Record<string, SecurityScheme>,
    Auth,
    const Name extends Extract<keyof Schemes, string>,
>(
    _contract: Contract<R, Record<string, TagOptions>, string, Schemes, Auth>,
    _identity: Name,
    run: GuardFns<Schemes, GuardParams<R, Auth, Name>>[Name]
): GuardRun<NextHandlerContext> {
    return run as unknown as GuardRun<NextHandlerContext>;
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
     * Authentication belongs in a guard.
     *
     * @deprecated Define auth with identities + the contract's `auth` map and pass
     * `guards` to `createApi`. See /docs/auth.
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
    /**
     * How long a streaming response may sit idle before a keep-alive comment is
     * sent, in milliseconds. `0` disables it.
     *
     * @default 15000
     */
    streamKeepAliveMs?: number;
    /**
     * Called when a streaming response fails after its first event. Separate from
     * `onError` because the status is already sent by then, so there is no response
     * left to return. Without this the error is logged to `console.error`.
     */
    onStreamError?: (error: unknown, request: NextRequest) => void;
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
    middlewareMap?: MiddlewareMap<Routes, NextMiddlewareHandler>
): Promise<NextResponse> => {
    const url = new URL(request.url);

    const adapter = createAdapter<NextRequest, NextResponse, NextHandlerContext>({
        buildHandlerContext: (adapterRequest) => ({
            request: adapterRequest.request,
        }),
        respond: (result) => {
            if (result.kind === 'raw-response') return result.response as NextResponse;
            if (result.kind === 'stream') {
                const { body, ...init } = sseResponseInit(result, {
                    signal: request.signal,
                    onError: (error) => reportStreamError('next', result.routeKey, error, request, options?.onStreamError),
                });
                return new NextResponse(body, init);
            }
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
                signal: request.signal,
            };

            return adapter.handle({
                routes,
                router,
                request: adapterRequest,
                responseContext: {},
                guards,
                schemes,
                requestContext,
                responseValidation: options?.responseValidation,
                streamKeepAliveMs: options?.streamKeepAliveMs,
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
        signal: request.signal,
    };

    return adapter.handle({
        routes,
        router,
        request: adapterRequest,
        responseContext: {},
        guards,
        schemes,
        requestContext,
        basePath: options?.basePath,
        responseValidation: options?.responseValidation,
        streamKeepAliveMs: options?.streamKeepAliveMs,
    });
};
