import { z } from 'zod';
import { createModel } from './model.js';

/**
 * RFC 9457 Problem Details — the single error schema used across kizuna.
 *
 * Matches the shape returned by `deny()` in guards, validation errors,
 * and all built-in error responses (404, 405, 415, etc.).
 *
 * ```ts
 * import { ProblemDetailsSchema } from '@ts-kizuna/core/schemas';
 *
 * const routes = createRoutes({
 *     getUser: {
 *         method: 'GET',
 *         path: '/users/:id',
 *         responses: {
 *             200: UserSchema,
 *             404: ProblemDetailsSchema,
 *         },
 *     },
 * });
 * ```
 *
 * Add domain fields as RFC 9457 **extension members** with native `.extend` — inline:
 *
 * ```ts
 * responses: {
 *     409: ProblemDetailsSchema.extend({
 *         conflictingId: z.string(),
 *     }),
 * }
 * ```
 *
 * or as a named component (appears in the OpenAPI spec) via `createModel`:
 *
 * ```ts
 * export const ConflictError = createModel({
 *     title: 'ConflictError',
 *     schema: ProblemDetailsSchema.extend({
 *         conflictingId: z.string(),
 *     }),
 * });
 * ```
 *
 * The handler supplies `detail` plus any extensions; `type`/`title`/`status` are
 * auto-filled. Extension members are also how an API migrating onto kizuna keeps its
 * existing error fields (e.g. `errorCode`, `requestId`) — old clients still read them.
 */
export const ProblemDetailsSchema = createModel({
    title: 'ProblemDetails',
    description: 'RFC 9457 Problem Details error response.',
    schema: z.object({
        /**
         * Problem type URI. `about:blank` means no additional semantics beyond the status code.
         */
        type: z.string(),
        /**
         * Short human-readable summary matching the HTTP status phrase (e.g. "Not Found").
         */
        title: z.string(),
        /**
         * HTTP status code repeated inside the body for clients that cannot inspect headers.
         */
        status: z.number().int(),
        /**
         * Human-readable explanation specific to this occurrence of the problem.
         */
        detail: z.string(),
    }),
});

/**
 * Type guard for an RFC 9457 Problem Details body — the shared shape behind every kizuna
 * error response (validation failures, guards, handler errors, built-in 404/405/415, …).
 */
export function isProblemDetails(body: unknown): body is {
    type: string;
    title: string;
    status: number;
    detail: string;
} {
    if (body === null || typeof body !== 'object') return false;
    const candidate = body as Record<string, unknown>;
    return (
        typeof candidate.type === 'string' &&
        typeof candidate.title === 'string' &&
        typeof candidate.status === 'number' &&
        typeof candidate.detail === 'string'
    );
}
