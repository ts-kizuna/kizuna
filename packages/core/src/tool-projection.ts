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
 * is included because the method and path are the clearest statement of what a
 * route does to a caller that cannot read your docs.
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
 * each under its own key.
 *
 * Kept nested rather than flattened into one object so a path parameter and a
 * query field sharing a name cannot collide, and so the nesting tells the model
 * which values identify a resource.
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
 * The `{ status, body }` envelope a route answers with as a tool, `body`
 * carrying its JSON success bodies. A route with none answers with `status`
 * alone.
 *
 * The envelope is what carries a route's several success statuses, so a route
 * answering both `200` and `201` needs no union of results.
 */
export const routeToolOutput = (route: RouteDefinition): z.ZodType => {
    const bodies: z.ZodType[] = [];
    let someSuccessHasNoBody = false;

    for (const status of Object.keys(route.responses)
        .map(Number)
        .sort((left, right) => left - right)) {
        if (!isSuccessStatus(status)) continue;
        const response = route.responses[status];
        if (response === undefined) continue;
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

    const status = z.int().describe('The HTTP status the route answered with');

    if (bodies.length === 0) {
        return z.object({
            status,
        });
    }

    const body = bodies.length === 1 ? bodies[0]! : z.union(bodies);

    return z.object({
        status,
        body: someSuccessHasNoBody ? body.optional() : body,
    });
};
