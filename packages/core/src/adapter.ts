import type { z } from 'zod';
import type { RouteDefinition, Routes, Method } from './types.js';
import type { SecurityScheme } from './security-scheme.js';
import type { Credential, NoCredential } from './identity.js';
import {
    type RouteHandler,
    type Router,
    type RawInputs,
    type ValidationStage,
    allowedMethodsForPath,
    flattenRoutes,
    formatValidationError,
    validateRequest,
} from './handler-pipeline.js';
import { type MatchResult, matchRoute as defaultMatchRoute, sortFlattenedRoutes } from './route-matcher.js';
import { parsePath } from './path-params.js';
import { ResponseError } from './response-error.js';
import { problemDetails, type ProblemDetails } from './problem-details.js';
import { STATUS_TITLES } from './status-titles.js';
import { isVoidSchema, isBinarySchema } from './zod-internals.js';
import { resolveResponseBody, resolveResponseContentType, isJsonMediaType } from './generator-utils.js';

export type { RouteDefinition, Routes, Method } from './types.js';

export class ResponseValidationError extends Error {
    readonly routeKey: string;
    readonly status: number;
    readonly issues: z.core.$ZodIssue[];

    constructor(routeKey: string, status: number, issues: z.core.$ZodIssue[]) {
        super(`Response validation failed for ${routeKey} (status ${status})`);
        this.name = 'ResponseValidationError';
        this.routeKey = routeKey;
        this.status = status;
        this.issues = issues;
    }
}

export const API_META: unique symbol = Symbol('ts-kizuna.api.meta');
export const ROUTER_META: unique symbol = Symbol('ts-kizuna.router');
export const GUARDS_META: unique symbol = Symbol('ts-kizuna.guards');
export const SCHEMES_META: unique symbol = Symbol('ts-kizuna.schemes');
export const REQUEST_CONTEXT_META: unique symbol = Symbol('ts-kizuna.request-context');
/**
 * @deprecated Define auth with identities + the contract's `auth` map and pass
 * `guards` to `createApi`. See /docs/auth.
 */
export const MIDDLEWARE_META: unique symbol = Symbol('ts-kizuna.middleware');

export type ApiDefinition = { readonly [API_META]: true };
export type ApiWithRouter = ApiDefinition & { readonly [ROUTER_META]: Record<string, unknown> };

/**
 * The marker a guard's `deny(status, detail)` returns. Distinguishes a denial
 * from the context object a passing guard returns.
 */
const GUARD_DENY: unique symbol = Symbol('ts-kizuna.guard.deny');

/**
 * The result of `deny(status, detail)` inside a guard — short-circuits the
 * request with an RFC 9457 problem details response of the given status.
 */
export interface GuardDenial {
    readonly [GUARD_DENY]: true;
    status: number;
    detail: string;
}

/**
 * Reject the request from inside a guard.
 */
export type GuardDeny = (status: number, detail: string) => GuardDenial;

export const guardDeny: GuardDeny = (status, detail) => ({
    [GUARD_DENY]: true,
    status,
    detail,
});

export const isGuardDenial = (value: unknown): value is GuardDenial => typeof value === 'object' && value !== null && GUARD_DENY in value;

/**
 * The runtime behavior of a guard. It receives one object: the adapter's handler
 * context (e.g. `req`/`res`) plus the credential the identity's method extracted
 * from the request (or `null` if absent), a `deny` helper, and the matched
 * route's required `scopes`. It returns the context the scheme provides (nested
 * under `auth`, keyed by the identity's name in the handler args) or `deny(...)` to reject.
 */
export type GuardRun<HandlerContext = unknown> = (
    args: HandlerContext &
        Credential & {
            params: Record<string, string>;
            deny: GuardDeny;
            scopes: string[];
        }
) => Promise<Record<string, unknown> | GuardDenial | void> | Record<string, unknown> | GuardDenial | void;

/**
 * Guards keyed by the security scheme name they satisfy. A route's resolved
 * `security` selects which guards run before its handler.
 */
export type GuardMap<HandlerContext = unknown> = Record<string, GuardRun<HandlerContext>>;

/**
 * The runtime behavior of a request context resolver. It runs on every route
 * before the guards, receives the handler context plus the matched route's
 * `params`, and returns the value handlers read under the context's name. It
 * never denies a request.
 */
export type RequestContextRun<HandlerContext = unknown> = (
    args: HandlerContext & {
        params: Record<string, string>;
        headers: Record<string, string | string[] | undefined>;
    }
) => Promise<unknown> | unknown;

/**
 * Request context resolvers keyed by the name they were declared under on `kizuna`.
 */
export type RequestContextMap<HandlerContext = unknown> = Record<string, RequestContextRun<HandlerContext>>;

const assertNoDuplicateRoutes = (routes: Routes): void => {
    const seen = new Map<string, { routeKey: string; path: string }>();
    for (const { routeKey, route } of flattenRoutes(routes)) {
        const { segments } = parsePath(route.path);
        const normalizedPath = segments.map((segment) => (segment.kind === 'param' ? ':*' : segment.value)).join('');
        const key = `${route.method}:${normalizedPath}`;
        const conflict = seen.get(key);
        if (conflict) {
            throw new Error(
                `Duplicate route: "${routeKey}" (${route.method} ${route.path}) conflicts with "${conflict.routeKey}" (${route.method} ${conflict.path})`
            );
        }
        seen.set(key, { routeKey, path: route.path });
    }
};

export const createApi = <const R extends Routes>(routes: R): R & ApiDefinition => {
    assertNoDuplicateRoutes(routes);
    const result = { ...routes } as R & Record<typeof API_META, true>;
    result[API_META] = true;
    return result as unknown as R & ApiDefinition;
};
export type { FlattenedRoute, RouteHandler, Router, RawInputs, ValidationFailure, ValidationStage } from './handler-pipeline.js';
export { allowedMethodsForPath, flattenRoutes, formatValidationError, isRouteDefinition, validateRequest } from './handler-pipeline.js';
export { ResponseError } from './response-error.js';
export { problemDetails, type ProblemDetails } from './problem-details.js';
export type { MatchResult, RouteMatch } from './route-matcher.js';
export { matchRoute } from './route-matcher.js';
export { type MiddlewareMap, resolveMiddleware } from './middleware.js';

export type RouteMatcher = (method: string, path: string, routes: Routes, basePath?: string) => MatchResult;

export interface AdapterRequest<NativeRequest> {
    request: NativeRequest;
    method: string;
    /**
     * - `core-match` — core matches the path against the routes (Next-style catch-all routing).
     * - `pre-resolved` — adapter has already routed the request and tells core which route was matched (Express-style per-route registration).
     */
    resolution:
        | {
              kind: 'core-match';
              path: string;
          }
        | {
              kind: 'pre-resolved';
              routeKey: string;
              route: RouteDefinition;
              params: Record<string, string>;
          };
    query: unknown;
    headers: unknown;
    readBody: (route: RouteDefinition) => Promise<unknown> | unknown;
}

/**
 * Outcome of `runPipeline`. The adapter's `respond` translates this to a native response.
 *
 * Note: `raw-response` is an escape hatch for `onError` overrides — its `response` is
 * cast back to the adapter's `NativeResponse` by `respond`.
 */
export type AdapterResult =
    | {
          kind: 'not-found';
      }
    | {
          kind: 'method-not-allowed';
          allowed: Method[];
      }
    | {
          kind: 'unsupported-media-type';
          expected: string;
          received: string;
      }
    | {
          kind: 'invalid-body';
          detail: string;
      }
    | {
          kind: 'validation-failed';
          stage: ValidationStage;
          detail: string;
          issues: z.core.$ZodIssue[];
      }
    | {
          kind: 'no-handler';
          routeKey: string;
      }
    | {
          kind: 'guard-denied';
          status: number;
          detail: string;
      }
    | {
          kind: 'handler-error';
          routeKey: string;
          route: RouteDefinition;
          error: unknown;
      }
    | {
          kind: 'success';
          routeKey: string;
          route: RouteDefinition;
          status: number;
          body: unknown;
          headers?: Record<string, string>;
      }
    | {
          kind: 'not-acceptable';
      }
    | {
          kind: 'raw-response';
          response: unknown;
      };

export interface AdapterDefinition<NativeRequest, NativeResponse, HandlerContext, ResponseContext = Record<string, never>> {
    buildHandlerContext: (request: AdapterRequest<NativeRequest>, context: ResponseContext) => HandlerContext | Promise<HandlerContext>;
    respond: (result: AdapterResult, context: ResponseContext) => NativeResponse | Promise<NativeResponse>;
    /**
     * Return an `AdapterResult` to override the default `handler-error` outcome; return `void` to let it pass through.
     */
    onError?: (error: unknown, request: AdapterRequest<NativeRequest>) => AdapterResult | void | Promise<AdapterResult | void>;
    matcher?: RouteMatcher;
}

export interface HandleArgs<NativeRequest, HandlerContext, ResponseContext, TRoutes extends Routes> {
    routes: TRoutes;
    router: Router<TRoutes, HandlerContext>;
    request: AdapterRequest<NativeRequest>;
    responseContext: ResponseContext;
    /**
     * Guards keyed by security scheme name. The matched route's resolved
     * `security` selects which run before its handler; their returned context is
     * merged into the handler args.
     */
    guards?: GuardMap<HandlerContext>;
    /**
     * The contract's identities keyed by name. The runtime extracts each required
     * scheme's credential from the request (per its declared location) and passes
     * it to that scheme's guard.
     */
    schemes?: Record<string, SecurityScheme>;
    /**
     * Request context resolvers keyed by name. Each runs on every route before
     * the guards; its value lands in the handler args under `requestContext`, keyed by its name.
     */
    requestContext?: RequestContextMap<HandlerContext>;
    basePath?: string;
    responseValidation?: boolean;
}

/**
 * Expand a route's resolved `security` into the concrete (scheme, scopes) pairs
 * whose guards must run before the handler.
 */
export const resolveSecurityRequirements = (route: RouteDefinition): Array<{ scheme: string; scopes: string[] }> => {
    const requirements: Array<{ scheme: string; scopes: string[] }> = [];
    for (const entry of route.security ?? []) {
        if (typeof entry === 'string') {
            requirements.push({
                scheme: entry,
                scopes: [],
            });
            continue;
        }
        for (const [scheme, scopes] of Object.entries(entry)) {
            requirements.push({
                scheme,
                scopes: [...(scopes ?? [])],
            });
        }
    }
    return requirements;
};

/**
 * Read a raw header value as a single string: the first entry of an array
 * header, `undefined` when absent. For guards and request context resolvers on
 * adapters that expose raw header records.
 */
export const getHeaderValue = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
    return undefined;
};

const parseCookies = (cookieHeader: string | undefined): Record<string, string> => {
    const cookies: Record<string, string> = {};
    if (!cookieHeader) return cookies;
    for (const part of cookieHeader.split(';')) {
        const separator = part.indexOf('=');
        if (separator === -1) continue;
        const name = part.slice(0, separator).trim();
        if (name) cookies[name] = decodeURIComponent(part.slice(separator + 1).trim());
    }
    return cookies;
};

/**
 * Whether a guard's returned field satisfies a gate value. Array fields pass
 * when they contain an allowed value; scalar fields when they equal one.
 */
export const gatePermits = (value: unknown, allowed: unknown): boolean => {
    if (Array.isArray(value)) {
        return Array.isArray(allowed) ? allowed.some((entry) => value.includes(entry)) : value.includes(allowed);
    }
    return Array.isArray(allowed) ? allowed.includes(value) : value === allowed;
};

/**
 * Extract the credential an identity's authentication method expects from the
 * request, labelled with its scheme kind: the value of the named
 * header/query/cookie for `apiKey`, the decoded `username`/`password` for HTTP
 * `basic`, or the bearer token for everything else. The credential is `null`
 * when it is absent or malformed.
 */
export const extractCredential = (scheme: SecurityScheme, request: AdapterRequest<unknown>): Credential | NoCredential => {
    const openapi = scheme.openapi;
    // A custom identity has no scheme to read from; its guard reads the credential itself.
    if (!openapi) return {};
    const headers = (request.headers ?? {}) as Record<string, string | string[] | undefined>;

    if (openapi.type === 'apiKey') {
        let value: string | undefined;
        if (openapi.in === 'header') value = getHeaderValue(headers[openapi.name.toLowerCase()]);
        else if (openapi.in === 'cookie') value = parseCookies(getHeaderValue(headers['cookie']))[openapi.name];
        else {
            const query = (request.query ?? {}) as Record<string, unknown>;
            const queryValue = query[openapi.name];
            value = typeof queryValue === 'string' ? queryValue : undefined;
        }
        return { apiKey: value === undefined ? null : { in: openapi.in, name: openapi.name, value } };
    }

    const authorization = getHeaderValue(headers['authorization']);
    if (openapi.type === 'http' && openapi.scheme === 'basic') {
        let credentials: { username: string; password: string } | null = null;
        if (authorization && /^basic\s+/i.test(authorization)) {
            try {
                const decoded = atob(authorization.replace(/^basic\s+/i, ''));
                const separator = decoded.indexOf(':');
                if (separator !== -1) credentials = { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
            } catch {
                credentials = null;
            }
        }
        return { basic: credentials };
    }

    const bearer = authorization ? /^bearer\s+(.+)$/i.exec(authorization) : null;
    const token = bearer ? { token: bearer[1]! } : null;
    if (openapi.type === 'oauth2') return { oauth2: token };
    if (openapi.type === 'openIdConnect') return { openIdConnect: token };
    return { bearer: token };
};

export interface Adapter<NativeRequest, NativeResponse, HandlerContext, ResponseContext> {
    handle: <T extends Routes>(args: HandleArgs<NativeRequest, HandlerContext, ResponseContext, T>) => Promise<NativeResponse>;
    eachRoute: <T extends Routes>(
        routes: T,
        router: Router<T, HandlerContext>
    ) => Iterable<{
        routeKey: string;
        route: RouteDefinition;
        handler: RouteHandler<RouteDefinition, HandlerContext>;
    }>;
}

const resolveHandler = (handlers: unknown, routeKey: string): unknown => {
    const segments = routeKey.split('.');
    let current: unknown = handlers;
    for (const segment of segments) {
        if (!current || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[segment];
    }
    return current;
};

interface ResolvedRoute {
    routeKey: string;
    route: RouteDefinition;
    params: Record<string, string>;
}

const resolveRoute = (
    request: AdapterRequest<unknown>,
    routes: Routes,
    matcher: RouteMatcher,
    basePath: string | undefined
): { ok: true; resolved: ResolvedRoute } | { ok: false; result: AdapterResult } => {
    if (request.resolution.kind === 'pre-resolved') {
        return {
            ok: true,
            resolved: {
                routeKey: request.resolution.routeKey,
                route: request.resolution.route,
                params: request.resolution.params,
            },
        };
    }
    const matched = matcher(request.method, request.resolution.path, routes, basePath);
    if (matched.kind === 'not-found') {
        return {
            ok: false,
            result: {
                kind: 'not-found',
            },
        };
    }
    if (matched.kind === 'method-mismatch') {
        return {
            ok: false,
            result: {
                kind: 'method-not-allowed',
                allowed: matched.allowed,
            },
        };
    }
    return {
        ok: true,
        resolved: {
            routeKey: matched.match.routeKey,
            route: matched.match.route,
            params: matched.match.params,
        },
    };
};

const isAcceptable = (acceptHeader: string | undefined): boolean => {
    if (!acceptHeader || acceptHeader.trim() === '') return true;
    for (const part of acceptHeader.split(',')) {
        const [mediaType = ''] = part.trim().split(';');
        const normalized = mediaType.trim().toLowerCase();
        if (normalized === '*/*' || normalized === 'application/*' || normalized === 'application/json') {
            return true;
        }
    }
    return false;
};

const runPipeline = async <NativeRequest, HandlerContext, ResponseContext>(
    request: AdapterRequest<NativeRequest>,
    routes: Routes,
    router: Router<Routes, HandlerContext>,
    definition: AdapterDefinition<NativeRequest, unknown, HandlerContext, ResponseContext>,
    responseContext: ResponseContext,
    guards: GuardMap<HandlerContext> | undefined,
    schemes: Record<string, SecurityScheme> | undefined,
    contextResolvers: RequestContextMap<HandlerContext> | undefined,
    basePath: string | undefined,
    responseValidation: boolean | undefined
): Promise<AdapterResult> => {
    const matcher = definition.matcher ?? defaultMatchRoute;
    const resolution = resolveRoute(request as AdapterRequest<unknown>, routes, matcher, basePath);
    if (!resolution.ok) return resolution.result;
    const { routeKey, route, params } = resolution.resolved;

    const raw: RawInputs = {
        params,
        query: request.query,
        headers: request.headers,
        body: undefined,
    };

    const acceptHeader = (raw.headers as Record<string, string | undefined>)['accept'];
    if (!isAcceptable(acceptHeader)) {
        return {
            kind: 'not-acceptable',
        };
    }

    if (route.body && !isVoidSchema(route.body)) {
        const expected = route.contentType ?? 'application/json';
        const contentTypeHeader = (raw.headers as Record<string, string | undefined>)['content-type'] ?? '';
        const [mediaType = ''] = contentTypeHeader.split(';');
        const received = mediaType.trim();
        if (received.toLowerCase() !== expected) {
            return {
                kind: 'unsupported-media-type',
                expected,
                received,
            };
        }
        try {
            raw.body = await request.readBody(route);
        } catch {
            return {
                kind: 'invalid-body',
                detail: 'Bad Request',
            };
        }
    }

    const validation = validateRequest(route, raw);
    if (!validation.ok) {
        const formatted = formatValidationError(validation.error);
        return {
            kind: 'validation-failed',
            stage: validation.error.stage,
            detail: formatted.detail,
            issues: formatted.issues,
        };
    }

    const handler = resolveHandler(router, routeKey);
    if (typeof handler !== 'function') {
        return {
            kind: 'no-handler',
            routeKey,
        };
    }

    try {
        const handlerContext = await definition.buildHandlerContext(request, responseContext);

        const requestContext: Record<string, unknown> = {};
        if (contextResolvers) {
            for (const [name, resolver] of Object.entries(contextResolvers)) {
                requestContext[name] = await resolver({
                    ...(handlerContext as Record<string, unknown>),
                    params,
                    headers: raw.headers as Record<string, string | string[] | undefined>,
                } as Parameters<typeof resolver>[0]);
            }
        }

        const securityContext: Record<string, unknown> = {};
        for (const { scheme, scopes } of resolveSecurityRequirements(route)) {
            const guard = guards?.[scheme];
            if (!guard) {
                throw new Error(`No guard registered for security scheme "${scheme}" required by route "${routeKey}".`);
            }
            const schemeDefinition = schemes?.[scheme];
            const credential = schemeDefinition ? extractCredential(schemeDefinition, request as AdapterRequest<unknown>) : {};
            const guardResult = await guard({
                ...(handlerContext as Record<string, unknown>),
                ...credential,
                params,
                deny: guardDeny,
                scopes,
            } as Parameters<typeof guard>[0]);
            if (isGuardDenial(guardResult)) {
                return {
                    kind: 'guard-denied',
                    status: guardResult.status,
                    detail: guardResult.detail,
                };
            }
            if (guardResult && typeof guardResult === 'object') {
                const gate = route.accessGate?.[scheme];
                if (gate) {
                    for (const [field, allowed] of Object.entries(gate)) {
                        const value = (guardResult as Record<string, unknown>)[field];
                        const permitted = gatePermits(value, allowed);
                        if (!permitted) {
                            return {
                                kind: 'guard-denied',
                                status: 403,
                                detail: `Forbidden: ${scheme}.${field} is not permitted on this route.`,
                            };
                        }
                    }
                }
                securityContext[scheme] = guardResult;
            }
        }

        const throwError = (response: { status: number; body: unknown; headers?: Record<string, string> }): never => {
            throw new ResponseError(response);
        };
        const handlerResult = await (
            handler as (args: unknown) => Promise<{ status: number; body: unknown; headers?: Record<string, string> }>
        )({
            params: validation.parsed.params,
            query: validation.parsed.query,
            body: validation.parsed.body,
            headers: validation.parsed.headers,
            throwError,
            // Deprecated alias for `throwError`; kept for backward compatibility.
            error: throwError,
            ...handlerContext,
            ...(Object.keys(requestContext).length > 0 ? { requestContext } : {}),
            ...(Object.keys(securityContext).length > 0 ? { auth: securityContext } : {}),
        });
        if (responseValidation) {
            const responseSpec = route.responses[handlerResult.status];
            if (responseSpec !== undefined) {
                const bodySchema = 'safeParse' in responseSpec ? responseSpec : responseSpec.body;
                // Error responses (status >= 400) auto-fill the Problem Details envelope
                // (`type`/`title`/`status`) at render time, so the handler only supplies
                // `detail` plus extensions. Validate the final wire shape, not the partial
                // body — otherwise every valid error handler would fail validation.
                const bodyToValidate =
                    handlerResult.status >= 400 && handlerResult.body !== null && typeof handlerResult.body === 'object'
                        ? {
                              type: 'about:blank',
                              title: STATUS_TITLES[handlerResult.status] ?? 'Unknown Error',
                              status: handlerResult.status,
                              ...(handlerResult.body as Record<string, unknown>),
                          }
                        : handlerResult.body;
                const parseResult = bodySchema.safeParse(bodyToValidate);
                if (!parseResult.success) {
                    throw new ResponseValidationError(routeKey, handlerResult.status, parseResult.error.issues);
                }
            }
        }
        const successHeaders =
            route.method === 'OPTIONS'
                ? {
                      Allow: allowedMethodsForPath(routes, route.path).join(', '),
                      ...(handlerResult.headers ?? {}),
                  }
                : handlerResult.headers;
        return {
            kind: 'success',
            routeKey,
            route,
            status: handlerResult.status,
            body: route.method === 'HEAD' ? undefined : handlerResult.body,
            headers: successHeaders,
        };
    } catch (error) {
        if (error instanceof ResponseError) {
            return {
                kind: 'success',
                routeKey,
                route,
                status: error.status,
                body: error.body,
                headers: error.headers ?? {},
            };
        }
        if (definition.onError) {
            try {
                const override = await definition.onError(error, request);
                if (override) return override;
            } catch (hookError) {
                console.error('[ts-kizuna] onError hook threw:', hookError);
            }
        }
        return {
            kind: 'handler-error',
            routeKey,
            route,
            error,
        };
    }
};

export const createAdapter = <NativeRequest, NativeResponse, HandlerContext, ResponseContext = Record<string, never>>(
    definition: AdapterDefinition<NativeRequest, NativeResponse, HandlerContext, ResponseContext>
): Adapter<NativeRequest, NativeResponse, HandlerContext, ResponseContext> => ({
    handle: async ({ routes, router, request, responseContext, guards, schemes, requestContext, basePath, responseValidation }) => {
        const result = await runPipeline(
            request,
            routes,
            router as Router<Routes, HandlerContext>,
            definition as AdapterDefinition<NativeRequest, unknown, HandlerContext, ResponseContext>,
            responseContext,
            guards,
            schemes,
            requestContext,
            basePath,
            responseValidation
        );
        return definition.respond(result, responseContext);
    },
    eachRoute: function* (routes, router) {
        const sorted = sortFlattenedRoutes(flattenRoutes(routes));
        for (const { routeKey, route } of sorted) {
            const handler = resolveHandler(router, routeKey);
            if (typeof handler !== 'function') continue;
            yield {
                routeKey,
                route,
                handler: handler as RouteHandler<RouteDefinition, HandlerContext>,
            };
        }
    },
});

/**
 * Decides the bytes that go on the wire for an error (status >= 400). The default emits the
 * canonical RFC 9457 Problem Details as `application/problem+json`.
 *
 * **Most migrations don't need this.** Carrying your existing fields as Problem Details
 * extension members keeps a single body valid for both old and new clients.
 *
 * **Reach for it only when** an older client needs a different content type (plain
 * `application/json`) or a structurally different body. It receives the request, so if you
 * can tell clients apart (a version header, `Accept`, …) you can serve the legacy shape to
 * old clients and Problem Details to new ones during a transition — then delete it.
 */
export type ErrorFormatter<NativeRequest = unknown> = (
    problem: ProblemDetails & Record<string, unknown>,
    context: {
        status: number;
        request: NativeRequest;
    }
) => {
    contentType: string;
    body: unknown;
};

const defaultErrorFormatter: ErrorFormatter = (problem) => ({
    contentType: 'application/problem+json',
    body: problem,
});

const describeBodyType = (body: unknown): string => {
    if (body === null) return 'null';
    if (Array.isArray(body)) return 'an array';
    return `a value of type ${typeof body}`;
};

/**
 * Maps an `AdapterResult` to `{ status, headers, body }` using ts-kizuna's default
 * JSON conventions (e.g. 405 with an `Allow` header, 400 with `{ detail, errors }`
 * for validation failures). Adapters that speak JSON delegate `respond` to this
 * instead of writing the switch by hand.
 *
 * Every error (status >= 400) is an RFC 9457 Problem Details object run through
 * `formatError` — there is no custom-error-shape passthrough. Pass an `ErrorFormatter`
 * to reshape the wire bytes for migration; the canonical problem is unchanged.
 *
 * `raw-response` is excluded — it carries a framework-specific `NativeResponse`
 * the adapter must return directly, so handle that case before calling this.
 */
export const renderJsonResult = (
    result: Exclude<AdapterResult, { kind: 'raw-response' }>,
    formatError: ErrorFormatter = defaultErrorFormatter,
    request: unknown = undefined
): { status: number; headers: Record<string, string>; body: unknown; raw?: boolean } => {
    const renderError = (
        status: number,
        detail: string,
        extensions?: Record<string, unknown>,
        extraHeaders?: Record<string, string>
    ): { status: number; headers: Record<string, string>; body: unknown } => {
        const problem = problemDetails(status, detail, extensions);
        const { contentType, body } = formatError(problem, { status, request });
        return {
            status,
            headers: {
                'content-type': contentType,
                ...(extraHeaders ?? {}),
            },
            body,
        };
    };

    switch (result.kind) {
        case 'success': {
            if (result.status >= 400) {
                const body = result.body;
                const extensions = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
                const detail = typeof extensions.detail === 'string' ? extensions.detail : (STATUS_TITLES[result.status] ?? 'Error');
                return renderError(result.status, detail, extensions, result.headers);
            }
            if (result.body === undefined) {
                return {
                    status: result.status,
                    headers: {
                        ...(result.headers ?? {}),
                    },
                    body: result.body,
                };
            }
            const responseSpec = result.route.responses[result.status];
            const isBinary = responseSpec !== undefined && isBinarySchema(resolveResponseBody(responseSpec));
            const contentType = resolveResponseContentType(responseSpec) ?? (isBinary ? 'application/octet-stream' : 'application/json');
            const raw = isBinary || !isJsonMediaType(contentType);
            if (raw && typeof result.body !== 'string' && !(result.body instanceof Uint8Array)) {
                throw new Error(
                    `${result.routeKey} (status ${result.status}) is declared with content type "${contentType}", so its body must be a string or Uint8Array, but the handler returned ${describeBodyType(result.body)}.`
                );
            }
            return {
                status: result.status,
                headers: {
                    'content-type': contentType,
                    ...(result.headers ?? {}),
                },
                body: result.body,
                raw,
            };
        }
        case 'not-found':
            return renderError(404, 'Not Found');
        case 'method-not-allowed':
            return renderError(
                405,
                'Method Not Allowed',
                {
                    allowed: result.allowed,
                },
                {
                    Allow: result.allowed.join(', '),
                }
            );
        case 'invalid-body':
            return renderError(400, result.detail);
        case 'validation-failed':
            return renderError(400, result.detail, {
                errors: result.issues.map((issue) => ({
                    code: issue.code ?? 'custom',
                    path: issue.path,
                    message: issue.message,
                })),
            });
        case 'no-handler':
            return renderError(500, `Handler not implemented: ${result.routeKey}`);
        case 'guard-denied':
            return renderError(result.status, result.detail);
        case 'unsupported-media-type':
            return renderError(415, `Unsupported Media Type: expected ${result.expected}, received ${result.received}`);
        case 'not-acceptable':
            return renderError(406, 'Not Acceptable');
        case 'handler-error':
            return renderError(500, 'Internal Server Error');
    }
};

const formDataToObject = (form: FormData): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of form.entries()) {
        const existing = result[key];
        if (existing === undefined) {
            result[key] = value;
        } else if (Array.isArray(existing)) {
            existing.push(value);
        } else {
            result[key] = [existing, value];
        }
    }
    return result;
};

/**
 * Content-type-aware body parser for Web Fetch `Request`.
 *
 * Reusable across any Fetch-based adapter.
 *
 * */
export const parseFetchBody = async (request: Request, route: RouteDefinition): Promise<unknown> => {
    switch (route.contentType) {
        case 'multipart/form-data':
            return formDataToObject(await request.formData());
        case 'application/x-www-form-urlencoded':
            return Object.fromEntries(new URLSearchParams(await request.text()));
        default: {
            const text = await request.text();
            return text.length > 0 ? JSON.parse(text) : undefined;
        }
    }
};

export const headersToObject = (headers: Headers): Record<string, string> => {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
        result[key] = value;
    });
    return result;
};
