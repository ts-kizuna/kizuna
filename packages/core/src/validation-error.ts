export interface ValidationError {
    message: string;
    issues: Array<{
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
