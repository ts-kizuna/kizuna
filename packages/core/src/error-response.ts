import { z } from 'zod';
import { createModel } from './model.js';

/**
 * RFC 9457 Problem Details error response used across kizuna.
 *
 * Matches the shape returned by `deny()` in guards, validation errors,
 * and all built-in error responses (404, 405, 415, etc.).
 *
 * ```ts
 * import { ErrorResponse } from '@ts-kizuna/core/schemas';
 *
 * const contract = createContract({
 *     getUser: {
 *         method: 'GET',
 *         path: '/users/:id',
 *         responses: {
 *             200: UserSchema,
 *             404: ErrorResponse,
 *         },
 *     },
 * });
 * ```
 */
export const ErrorResponse = createModel({
    title: 'ErrorResponse',
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
