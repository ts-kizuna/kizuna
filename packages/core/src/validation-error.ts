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
        type: z.string(),
        title: z.string(),
        status: z.number().int(),
        detail: z.string(),
        errors: z.array(
            z.object({
                code: ValidationIssueCodeSchema,
                path: z.array(z.string()),
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
