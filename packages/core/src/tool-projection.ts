import { z } from 'zod';
import { parsePath } from './path-params.js';
import { isJsonMediaType, isStreamResponse, isSuccessStatus, resolveResponseBody, resolveResponseContentType } from './generator-utils.js';
import { isVoidSchema, readObjectShape } from './zod-internals.js';
import type { Method, RouteDefinition } from './types.js';
import type { ToolAnnotations } from './tools.js';

/**
 * Safe per RFC 9110 section 9.2.1: they request no change to the server's
 * state.
 */
const SAFE_METHODS: ReadonlySet<Method> = new Set<Method>(['GET', 'HEAD', 'OPTIONS']);

/**
 * Idempotent per RFC 9110 section 9.2.2: repeating one has the same effect as
 * making it once. Every safe method is idempotent.
 */
const IDEMPOTENT_METHODS: ReadonlySet<Method> = new Set<Method>(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);

export const isSafeMethod = (method: Method): boolean => SAFE_METHODS.has(method);

export const isIdempotentMethod = (method: Method): boolean => IDEMPOTENT_METHODS.has(method);

/**
 * A tool reads JSON, so a route that takes a form body has nothing to receive
 * one.
 */
export const takesJsonInput = (route: RouteDefinition): boolean =>
    route.contentType === undefined || route.contentType === 'application/json';

/**
 * How a route behaves, read from its method's RFC 9110 semantics. MCP defaults
 * `destructiveHint` and `openWorldHint` to true, so the hints worth setting are
 * the ones that make a tool safer than that.
 */
export const routeToolAnnotations = (route: RouteDefinition): ToolAnnotations => ({
    ...(isSafeMethod(route.method) ? { readOnlyHint: true } : {}),
    ...(isIdempotentMethod(route.method) ? { idempotentHint: true } : {}),
    ...(route.method === 'DELETE' ? { destructiveHint: true } : {}),
});

/**
 * What a model reads before it decides whether to call the route. The HTTP line
 * goes in too: the method and path say what the route does to a caller that
 * cannot read your docs.
 */
export const routeToolDescription = (route: RouteDefinition): string => {
    const parts: string[] = [];
    if (route.summary) parts.push(route.summary);
    if (route.description) parts.push(route.description);
    if (parts.length === 0) parts.push(`${route.method} ${route.path}`);
    parts.push(`\nHTTP: ${route.method} ${route.path}`);
    return parts.join('\n');
};

/**
 * The arguments a route takes as a tool: its path parameters, query and body,
 * each under its own key, so a path parameter and a query field sharing a name
 * cannot collide.
 */
export const routeToolInput = (route: RouteDefinition): z.ZodType | undefined => {
    const shape: Record<string, z.ZodType> = {};

    const paramNames = parsePath(route.path).paramNames;
    if (paramNames.length > 0) {
        const paramShape: Record<string, z.ZodType> = {};
        const explicitShape = (route.pathParams ? readObjectShape(route.pathParams) : undefined) as Record<string, z.ZodType> | undefined;
        for (const name of paramNames) {
            paramShape[name] = explicitShape?.[name] ?? z.string();
        }
        shape['params'] = z.object(paramShape);
    }

    if (route.query) {
        shape['query'] = route.query.safeParse({}).success ? route.query.optional() : route.query;
    }

    if (route.body && !isVoidSchema(route.body)) {
        shape['body'] = route.body.safeParse(undefined).success ? route.body.optional() : route.body;
    }

    return Object.keys(shape).length === 0 ? undefined : z.object(shape);
};

/**
 * The envelope a tool answers with. `body` carries its JSON success bodies,
 * `detail` the words behind a failing status.
 *
 * A failing status leaves its body out, so `body` stays one shape per tool
 * rather than a union the Swift and Kotlin generators cannot narrow.
 */
export const routeToolOutput = (route: Pick<RouteDefinition, 'responses'>): z.ZodType => {
    const bodies: z.ZodType[] = [];
    let someSuccessHasNoBody = false;
    let canFail = false;

    for (const status of Object.keys(route.responses)
        .map(Number)
        .sort((left, right) => left - right)) {
        const response = route.responses[status];
        if (response === undefined) continue;
        if (!isSuccessStatus(status)) {
            canFail = true;
            continue;
        }
        const contentType = resolveResponseContentType(response);
        if (isStreamResponse(response) || (contentType !== undefined && !isJsonMediaType(contentType))) {
            someSuccessHasNoBody = true;
            continue;
        }
        const body = resolveResponseBody(response)!;
        if (isVoidSchema(body)) {
            someSuccessHasNoBody = true;
            continue;
        }
        bodies.push(body);
    }

    const detail = canFail
        ? {
              detail: z.string().describe('Why the call failed, when the status says it did').optional(),
          }
        : {};

    const statuses = Object.keys(route.responses)
        .map(Number)
        .sort((left, right) => left - right);
    // A closed set, so a model reads which statuses exist rather than a range.
    const status = z.literal(statuses).describe('The status the call answered with');

    if (bodies.length === 0) {
        return z.object({
            status,
            ...detail,
        });
    }

    const body = bodies.length === 1 ? bodies[0]! : z.union(bodies);

    return z.object({
        status,
        body: someSuccessHasNoBody || canFail ? body.optional() : body,
        ...detail,
    });
};

/**
 * One answered call in that envelope.
 */
export const toToolEnvelope = (status: number, body: unknown): { status: number; body?: unknown; detail?: string } => {
    if (isSuccessStatus(status)) {
        return body === undefined
            ? {
                  status,
              }
            : {
                  status,
                  body,
              };
    }
    const detail = readDetail(body);
    return detail === undefined
        ? {
              status,
          }
        : {
              status,
              detail,
          };
};

/**
 * The words in a failure body: RFC 9457's `detail`, then its `title`, then the
 * `message` a route may have written instead.
 */
const readDetail = (body: unknown): string | undefined => {
    if (typeof body === 'string') return body;
    if (!body || typeof body !== 'object') return undefined;
    const given = body as Record<string, unknown>;
    for (const field of ['detail', 'title', 'message']) {
        const value = given[field];
        if (typeof value === 'string' && value !== '') return value;
    }
    return undefined;
};
