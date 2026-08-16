/**
 * Thrown when a route returns a status its contract does not declare. Declared
 * statuses come back as `data` instead.
 */
export class UndeclaredResponseError extends Error {
    readonly status: number;
    readonly body: unknown;
    readonly headers: Record<string, string>;

    constructor(routeKey: string, status: number, body: unknown, headers: Record<string, string>) {
        super(`${routeKey} responded ${status}, which its contract does not declare.`);
        this.name = 'UndeclaredResponseError';
        this.status = status;
        this.body = body;
        this.headers = headers;
    }
}

/**
 * Narrows an `error` from a query or mutation to {@link UndeclaredResponseError}.
 */
export const isUndeclaredResponseError = (error: unknown): error is UndeclaredResponseError => error instanceof UndeclaredResponseError;
