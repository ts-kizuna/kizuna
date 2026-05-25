import { z } from 'zod';
import { createModel } from './model.js';

/**
 * Standard error response used across kizuna.
 *
 * Matches the shape returned by `deny()` in guards, validation errors,
 * and all built-in error responses (404, 405, 415, etc.).
 *
 * ```ts
 * import { ErrorResponse } from '@ts-kizuna/core';
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
    description: 'Standard error response with a message describing what went wrong.',
    schema: z.object({
        message: z.string(),
    }),
});
