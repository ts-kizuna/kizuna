import { z } from 'zod';
import { createModel } from './model.js';

/**
 * Machine-readable error classification from Zod.
 *
 * Known codes map to Zod's built-in checks. User-defined checks (`.refine()`,
 * `.superRefine()`) produce `custom` by default, but `.superRefine()` can emit
 * any string via `ctx.addIssue()` — hence the `z.string()` fallback.
 */
const ValidationIssueCodeSchema = z.union([
    z.enum([
        'invalid_type',
        'too_small',
        'too_big',
        'invalid_string_format',
        'not_multiple_of',
        'unrecognized_keys',
        'invalid_union',
        'invalid_key',
        'invalid_element',
        'invalid_value',
        'custom',
    ]),
    z.string(),
]);

export type ValidationIssueCode = z.infer<typeof ValidationIssueCodeSchema>;

/**
 * RFC 9457 Problem Details error response for validation failures.
 *
 * Extends the base Problem Details shape with an `errors` extension member
 * listing each field-level validation failure.
 *
 * ```ts
 * import { ValidationErrorResponse } from '@ts-kizuna/core/schemas';
 *
 * const contract = createContract({
 *     createUser: {
 *         method: 'POST',
 *         path: '/users',
 *         body: CreateUserSchema,
 *         responses: {
 *             201: UserSchema,
 *             400: ValidationErrorResponse,
 *         },
 *     },
 * });
 * ```
 */
export const ValidationErrorResponse = createModel({
    title: 'ValidationErrorResponse',
    description: 'RFC 9457 Problem Details error response for validation failures.',
    schema: z.object({
        /**
         * Problem type URI. `about:blank` means no additional semantics beyond the status code.
         */
        type: z.string(),
        /**
         * Short human-readable summary matching the HTTP status phrase (e.g. "Bad Request").
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
        /**
         * Field-level validation failures produced by Zod.
         */
        errors: z.array(
            z.object({
                /**
                 * Machine-readable error classification (e.g. `invalid_type`, `too_small`, `custom`).
                 */
                code: ValidationIssueCodeSchema,
                /**
                 * JSON path segments to the invalid field (e.g. `["address", "zip"]`).
                 */
                path: z.array(z.string()),
                /**
                 * Human-readable description of the validation failure.
                 */
                message: z.string(),
            })
        ),
    }),
});

export type ValidationError = z.infer<typeof ValidationErrorResponse>;

/**
 * Type guard for ts-kizuna's validation error response body (400).
 */
export function isValidationError(body: unknown): body is ValidationError {
    return body !== null && typeof body === 'object' && 'errors' in body && Array.isArray((body as Record<string, unknown>).errors);
}
