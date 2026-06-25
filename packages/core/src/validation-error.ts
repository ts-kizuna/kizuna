import { z } from 'zod';
import { createModel } from './model.js';
import { ProblemDetailsSchema } from './error-response.js';

/**
 * Zod's built-in issue codes. User-defined checks (`.refine()`,
 * `.superRefine()`) produce `custom` by default, but `.superRefine()` can emit
 * any string via `ctx.addIssue()` — see {@link ValidationIssueCode}.
 */
export const BUILTIN_VALIDATION_ISSUE_CODES = [
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
] as const;

/**
 * Machine-readable error classification.
 *
 * Built-in Zod codes are offered as autocomplete suggestions, while any custom
 * string remains assignable — the `string & {}` branch keeps the literal
 * suggestions from collapsing into a bare `string`.
 */
export type ValidationIssueCode = (typeof BUILTIN_VALIDATION_ISSUE_CODES)[number] | (string & {});

/**
 * Machine-readable error classification from Zod.
 *
 * Known codes map to Zod's built-in checks; any other string is allowed for
 * custom-coded issues — hence the `z.string()` fallback. The static type is
 * pinned to {@link ValidationIssueCode} so the union does not collapse to a
 * bare `string` when inferred, preserving autocomplete on both the producing
 * and consuming side.
 */
const ValidationIssueCodeSchema = z.union([
    z.enum(BUILTIN_VALIDATION_ISSUE_CODES),
    z.string(),
]) as unknown as z.ZodType<ValidationIssueCode>;

/**
 * RFC 9457 Problem Details error response for validation failures.
 *
 * Extends the base Problem Details shape with an `errors` extension member
 * listing each field-level validation failure.
 *
 * ```ts
 * import { ValidationErrorSchema } from '@ts-kizuna/core/schemas';
 *
 * const routes = createRoutes({
 *     createUser: {
 *         method: 'POST',
 *         path: '/users',
 *         body: CreateUserSchema,
 *         responses: {
 *             201: UserSchema,
 *             400: ValidationErrorSchema,
 *         },
 *     },
 * });
 * ```
 */
export const ValidationErrorSchema = createModel({
    title: 'ValidationError',
    description: 'RFC 9457 Problem Details error response for validation failures.',
    schema: ProblemDetailsSchema.extend({
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

export type ValidationError = z.infer<typeof ValidationErrorSchema>;

/**
 * A {@link ValidationError} whose `errors[].code` is widened with the custom
 * issue `Codes` a specific route can emit.
 *
 * Built-in codes and any string remain assignable (via {@link ValidationIssueCode});
 * the declared `Codes` are added as explicit literal members so clients get
 * autocomplete for them. With no custom codes it is identical to
 * {@link ValidationError}.
 */
export type ValidationErrorFor<Codes extends string = never> = Omit<ValidationError, 'errors'> & {
    errors: Array<{
        code: ValidationIssueCode | Codes;
        path: string[];
        message: string;
    }>;
};

/**
 * Type guard for ts-kizuna's validation error response body (400).
 */
export function isValidationError(body: unknown): body is ValidationError {
    return body !== null && typeof body === 'object' && 'errors' in body && Array.isArray((body as Record<string, unknown>).errors);
}
