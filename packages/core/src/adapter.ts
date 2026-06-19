import type { z } from 'zod';
import { type RouteDefinition, type Routes, type Method, PROBLEM_DETAILS_META } from './types.js';
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
export const MIDDLEWARE_META: unique symbol = Symbol('ts-kizuna.middleware');

export type ApiDefinition = { readonly [API_META]: true };
export type ApiWithRouter = ApiDefinition & { readonly [ROUTER_META]: Record<string, unknown> };

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
export type {
    FlattenedRoute,
    RouteHandler,
    Router,
    RawInputs,
    ValidationFailure,
    ValidationStage,
    ErrorMode,
    GuardErrorBody,
} from './handler-pipeline.js';
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
          /**
           * `false` when the contract opted out of Problem Details
           * (`kizuna({ problemDetails: false })`), so an error-status (>= 400) body
           * is rendered verbatim instead of wrapped in the RFC 9457 envelope.
           */
          problemDetails?: boolean;
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
    basePath?: string;
    responseValidation?: boolean;
}

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
    basePath: string | undefined,
    responseValidation: boolean | undefined
): Promise<AdapterResult> => {
    const matcher = definition.matcher ?? defaultMatchRoute;
    const resolution = resolveRoute(request as AdapterRequest<unknown>, routes, matcher, basePath);
    if (!resolution.ok) return resolution.result;
    const { routeKey, route, params } = resolution.resolved;

    const useProblemDetails = usesProblemDetails(routes);

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

        const error = (response: { status: number; body: unknown; headers?: Record<string, string> }): never => {
            throw new ResponseError(response);
        };
        const handlerResult = await (
            handler as (args: unknown) => Promise<{ status: number; body: unknown; headers?: Record<string, string> }>
        )({
            params: validation.parsed.params,
            query: validation.parsed.query,
            body: validation.parsed.body,
            headers: validation.parsed.headers,
            error,
            ...handlerContext,
        });
        if (responseValidation) {
            const responseSpec = route.responses[handlerResult.status];
            if (responseSpec !== undefined) {
                const bodySchema = 'safeParse' in responseSpec ? responseSpec : responseSpec.body;
                // In Problem Details mode, error responses (status >= 400) auto-fill the
                // envelope (`type`/`title`/`status`) at render time, so the handler only
                // supplies `detail` plus extensions. Validate the final wire shape, not the
                // partial body — otherwise every valid error handler would fail validation.
                // When the contract opted out, the body is sent verbatim, so validate it as-is.
                const bodyToValidate =
                    useProblemDetails &&
                    handlerResult.status >= 400 &&
                    handlerResult.body !== null &&
                    typeof handlerResult.body === 'object'
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
            problemDetails: useProblemDetails,
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
                problemDetails: useProblemDetails,
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
    handle: async ({ routes, router, request, responseContext, basePath, responseValidation }) => {
        const result = await runPipeline(
            request,
            routes,
            router as Router<Routes, HandlerContext>,
            definition as AdapterDefinition<NativeRequest, unknown, HandlerContext, ResponseContext>,
            responseContext,
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
            // Error-status bodies are wrapped in the RFC 9457 envelope unless the contract
            // opted out (`problemDetails === false`), in which case they fall through to the
            // verbatim path below and are sent as the literal declared shape.
            if (result.status >= 400 && result.problemDetails !== false) {
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
        case 'unsupported-media-type':
            return renderError(415, `Unsupported Media Type: expected ${result.expected}, received ${result.received}`);
        case 'not-acceptable':
            return renderError(406, 'Not Acceptable');
        case 'handler-error':
            return renderError(500, 'Internal Server Error');
    }
};

/**
 * Whether a contract's routes use RFC 9457 Problem Details for error responses.
 * `false` only when created with `kizuna({ problemDetails: false })`.
 */
export const usesProblemDetails = (routes: Routes): boolean =>
    (routes as Record<typeof PROBLEM_DETAILS_META, boolean | undefined>)[PROBLEM_DETAILS_META] !== false;

/**
 * Marker on the value `deny` returns, so adapters can tell a guard denial apart from a
 * framework-native response (e.g. a redirect a guard returns directly).
 */
export const GUARD_DENIAL: unique symbol = Symbol('ts-kizuna.guard-denial');

/**
 * A guard rejection produced by `deny`. Adapters render it with {@link renderGuardDenial}.
 */
export interface GuardDenial {
    readonly [GUARD_DENIAL]: true;
    status: number;
    body: unknown;
}

export const isGuardDenial = (value: unknown): value is GuardDenial =>
    typeof value === 'object' && value !== null && (value as Record<PropertyKey, unknown>)[GUARD_DENIAL] === true;

/**
 * Build a guard denial. `createGuard` passes a typed wrapper of this as `deny`. A string
 * argument is shorthand for `{ detail }`; an object is used as the body verbatim.
 */
export const guardDenial = (status: number, bodyOrDetail: unknown): GuardDenial => ({
    [GUARD_DENIAL]: true,
    status,
    body: typeof bodyOrDetail === 'string' ? { detail: bodyOrDetail } : bodyOrDetail,
});

/**
 * Render a guard denial to `{ status, headers, body }`, honoring the contract's error mode.
 * In Problem Details mode the body is wrapped in the RFC 9457 envelope; when the contract
 * opted out (`useProblemDetails === false`) it is sent verbatim as `application/json`.
 *
 * Routes through {@link renderJsonResult} so denials render exactly like handler error
 * responses. The denial isn't tied to a declared route response, so the content type
 * defaults to `application/json`.
 */
export const renderGuardDenial = (
    denial: GuardDenial,
    useProblemDetails: boolean
): { status: number; headers: Record<string, string>; body: unknown; raw?: boolean } =>
    renderJsonResult({
        kind: 'success',
        routeKey: '',
        route: { responses: {} } as RouteDefinition,
        status: denial.status,
        body: denial.body,
        problemDetails: useProblemDetails,
    });

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
