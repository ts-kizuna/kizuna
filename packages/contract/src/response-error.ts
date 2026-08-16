import type { RouteDefinition } from './types.js';
import type { HandlerReturn } from './handler-pipeline.js';

interface ResponseErrorPayload {
    status: number;
    body: unknown;
    headers?: Record<string, string>;
}

/**
 * Registered so `isResponseError` holds across two copies of this package,
 * which `instanceof` would not.
 */
const RESPONSE_ERROR: unique symbol = Symbol.for('ts-kizuna.response-error');

export class ResponseError<R extends RouteDefinition = never> extends Error {
    public readonly [RESPONSE_ERROR] = true;
    public readonly status: number;
    public readonly body: unknown;
    public readonly headers?: Record<string, string>;

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

export const isResponseError = (value: unknown): value is ResponseError => value instanceof Error && RESPONSE_ERROR in value;
