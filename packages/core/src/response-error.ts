import type { ResponseHeaders, RouteDefinition } from './types.js';
import type { HandlerReturn } from './handler-pipeline.js';

interface ResponseErrorPayload {
    status: number;
    body: unknown;
    headers?: ResponseHeaders;
}

export class ResponseError<R extends RouteDefinition = never> extends Error {
    public readonly status: number;
    public readonly body: unknown;
    public readonly headers?: ResponseHeaders;

    constructor(response: [R] extends [never] ? ResponseErrorPayload : HandlerReturn<R>) {
        const body = response.body;
        const message =
            body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string'
                ? body.detail
                : body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
                  ? body.error
                  : 'Response error';
        super(message);
        this.name = 'ResponseError';
        this.status = response.status;
        this.body = response.body;
        this.headers = response.headers;
    }
}
