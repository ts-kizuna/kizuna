/**
 * Thrown by a query or mutation when the response status is not 2xx, so React
 * Query surfaces it as `error` rather than `data`. Carries the typed response.
 */
export class KizunaHttpError<Body = unknown> extends Error {
    public readonly status: number;
    public readonly body: Body;
    public readonly headers: Record<string, string>;

    public constructor(response: { status: number; body: Body; headers: Record<string, string> }) {
        super(`HTTP ${response.status}`);
        this.name = 'KizunaHttpError';
        this.status = response.status;
        this.body = response.body;
        this.headers = response.headers;
    }
}
