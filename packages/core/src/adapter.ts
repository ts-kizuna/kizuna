import type { z } from 'zod';
import type { RouteDefinition, Contract, Method } from './types.js';
import {
    type RouteHandler,
    type Router,
    type RawInputs,
    type ValidationStage,
    allowedMethodsForPath,
    flattenContract,
    formatValidationError,
    validateRequest,
} from './handler-pipeline.js';
import { type MatchResult, matchRoute as defaultMatchRoute } from './route-matcher.js';
import { parsePath } from './path-params.js';
import { ResponseError } from './response-error.js';

export type { RouteDefinition, Contract, Method } from './types.js';

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

export type ApiDefinition = { readonly [API_META]: true };

const assertNoDuplicateRoutes = (contract: Contract): void => {
    const seen = new Map<string, { routeKey: string; path: string }>();
    for (const { routeKey, route } of flattenContract(contract)) {
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

export const createApi = <const R extends Contract>(contract: R): R & ApiDefinition => {
    assertNoDuplicateRoutes(contract);
    const result = { ...contract } as R & Record<typeof API_META, true>;
    result[API_META] = true;
    return result as unknown as R & ApiDefinition;
};
export type { FlattenedRoute, RouteHandler, Router, RawInputs, ValidationFailure, ValidationStage } from './handler-pipeline.js';
export { allowedMethodsForPath, flattenContract, formatValidationError, isRouteDefinition, validateRequest } from './handler-pipeline.js';
export type { MatchResult, RouteMatch } from './route-matcher.js';
export { matchRoute } from './route-matcher.js';

export type RouteMatcher = (method: string, path: string, contract: Contract, basePath?: string) => MatchResult;

export interface AdapterRequest<NativeRequest> {
    request: NativeRequest;
    method: string;
    /**
     * - `core-match` — core matches the path against the contract (Next-style catch-all routing).
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
          message: string;
      }
    | {
          kind: 'validation-failed';
          stage: ValidationStage;
          message: string;
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

export interface HandleArgs<NativeRequest, HandlerContext, ResponseContext, TContract extends Contract> {
    contract: TContract;
    router: Router<TContract, HandlerContext>;
    request: AdapterRequest<NativeRequest>;
    responseContext: ResponseContext;
    basePath?: string;
    responseValidation?: boolean;
}

export interface Adapter<NativeRequest, NativeResponse, HandlerContext, ResponseContext> {
    handle: <T extends Contract>(args: HandleArgs<NativeRequest, HandlerContext, ResponseContext, T>) => Promise<NativeResponse>;
    eachRoute: <T extends Contract>(
        contract: T,
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
    contract: Contract,
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
    const matched = matcher(request.method, request.resolution.path, contract, basePath);
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
    contract: Contract,
    router: Router<Contract, HandlerContext>,
    definition: AdapterDefinition<NativeRequest, unknown, HandlerContext, ResponseContext>,
    responseContext: ResponseContext,
    basePath: string | undefined,
    responseValidation: boolean | undefined
): Promise<AdapterResult> => {
    const matcher = definition.matcher ?? defaultMatchRoute;
    const resolution = resolveRoute(request as AdapterRequest<unknown>, contract, matcher, basePath);
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

    const bodySchemaType =
        (route.body as unknown as { _def?: { type?: string }; def?: { type?: string } } | undefined)?._def?.type ??
        (route.body as unknown as { _def?: { type?: string }; def?: { type?: string } } | undefined)?.def?.type;

    if (route.body && bodySchemaType !== 'void') {
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
                message: 'Bad Request',
            };
        }
    }

    const validation = validateRequest(route, raw);
    if (!validation.ok) {
        const formatted = formatValidationError(validation.error);
        return {
            kind: 'validation-failed',
            stage: validation.error.stage,
            message: formatted.message,
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
                const parseResult = bodySchema.safeParse(handlerResult.body);
                if (!parseResult.success) {
                    throw new ResponseValidationError(routeKey, handlerResult.status, parseResult.error.issues);
                }
            }
        }
        const successHeaders =
            route.method === 'OPTIONS'
                ? {
                      Allow: allowedMethodsForPath(contract, route.path).join(', '),
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
    handle: async ({ contract, router, request, responseContext, basePath, responseValidation }) => {
        const result = await runPipeline(
            request,
            contract,
            router as Router<Contract, HandlerContext>,
            definition as AdapterDefinition<NativeRequest, unknown, HandlerContext, ResponseContext>,
            responseContext,
            basePath,
            responseValidation
        );
        return definition.respond(result, responseContext);
    },
    eachRoute: function* (contract, router) {
        for (const { routeKey, route } of flattenContract(contract)) {
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
 * Maps an `AdapterResult` to `{ status, headers, body }` using ts-kizuna's default
 * JSON conventions (e.g. 405 with an `Allow` header, 400 with `{ message, issues }`
 * for validation failures). Adapters that speak JSON delegate `respond` to this
 * instead of writing the switch by hand.
 *
 * `raw-response` is excluded — it carries a framework-specific `NativeResponse`
 * the adapter must return directly, so handle that case before calling this.
 */
export const renderJsonResult = (
    result: Exclude<AdapterResult, { kind: 'raw-response' }>
): { status: number; headers: Record<string, string>; body: unknown } => {
    switch (result.kind) {
        case 'success':
            return {
                status: result.status,
                headers: {
                    'content-type': 'application/json',
                    ...(result.headers ?? {}),
                },
                body: result.body,
            };
        case 'not-found':
            return {
                status: 404,
                headers: {
                    'content-type': 'application/json',
                },
                body: {
                    message: 'Not Found',
                },
            };
        case 'method-not-allowed':
            return {
                status: 405,
                headers: {
                    'content-type': 'application/json',
                    Allow: result.allowed.join(', '),
                },
                body: {
                    message: 'Method Not Allowed',
                    allowed: result.allowed,
                },
            };
        case 'invalid-body':
            return {
                status: 400,
                headers: {
                    'content-type': 'application/json',
                },
                body: {
                    message: result.message,
                },
            };
        case 'validation-failed':
            return {
                status: 400,
                headers: {
                    'content-type': 'application/json',
                },
                body: {
                    message: result.message,
                    issues: result.issues.map((issue) => ({
                        code: issue.code ?? 'custom',
                        path: issue.path,
                        message: issue.message,
                    })),
                },
            };
        case 'no-handler':
            return {
                status: 500,
                headers: {
                    'content-type': 'application/json',
                },
                body: {
                    message: `Handler not implemented: ${result.routeKey}`,
                },
            };
        case 'unsupported-media-type':
            return {
                status: 415,
                headers: {
                    'content-type': 'application/json',
                },
                body: {
                    message: `Unsupported Media Type: expected ${result.expected}, received ${result.received}`,
                },
            };
        case 'not-acceptable':
            return {
                status: 406,
                headers: {
                    'content-type': 'application/json',
                },
                body: {
                    message: 'Not Acceptable',
                },
            };
        case 'handler-error':
            return {
                status: 500,
                headers: {
                    'content-type': 'application/json',
                },
                body: {
                    message: 'Internal Server Error',
                },
            };
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
