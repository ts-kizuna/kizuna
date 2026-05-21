/**
 * Machine-readable error classification from Zod.
 *
 * Known codes map to Zod's built-in checks. User-defined checks (`.refine()`,
 * `.superRefine()`) produce `custom` by default, but `.superRefine()` can emit
 * any string via `ctx.addIssue()` — hence the `(string & {})` escape hatch.
 */
export type ValidationIssueCode =
    | 'invalid_type'
    | 'too_small'
    | 'too_big'
    | 'invalid_string_format'
    | 'not_multiple_of'
    | 'unrecognized_keys'
    | 'invalid_union'
    | 'invalid_key'
    | 'invalid_element'
    | 'invalid_value'
    | 'custom'
    | (string & {});

/**
 * Shape of the 400 response body when request validation fails.
 *
 * ```json
 * {
 *   "message": "Invalid request body",
 *   "issues": [
 *     {
 *       "code": "invalid_type",
 *       "path": ["email"],
 *       "message": "Expected string, received number"
 *     },
 *     {
 *       "code": "custom",
 *       "path": ["phone"],
 *       "message": "Must include country code"
 *     }
 *   ]
 * }
 * ```
 */
export interface ValidationError {
    message: string;
    issues: Array<{
        code: ValidationIssueCode;
        path: PropertyKey[];
        message: string;
    }>;
}

/**
 * Type guard for ts-kizuna's validation error response body (400).
 */
export function isValidationError(body: unknown): body is ValidationError {
    return body !== null && typeof body === 'object' && 'issues' in body && Array.isArray((body as Record<string, unknown>).issues);
}
