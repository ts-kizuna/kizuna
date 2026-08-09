// Registry-global: a dual ESM/CJS install would otherwise hold two different
// symbols and the marker would silently stop matching.
const RAW_RESPONSE: unique symbol = Symbol.for('ts-kizuna.raw-response') as symbol as typeof RAW_RESPONSE;

export interface RawResponse {
    readonly [RAW_RESPONSE]: true;
    readonly response?: unknown;
}

/**
 * Answer with a response kizuna will neither validate nor render. For plugin
 * routes whose wire format is not JSON, such as MCP's JSON-RPC over
 * server-sent events. Ordinary route handlers cannot reach it.
 */
export const raw = (response?: unknown): RawResponse => ({
    [RAW_RESPONSE]: true,
    response,
});

export const isRawResponse = (value: unknown): value is RawResponse => typeof value === 'object' && value !== null && RAW_RESPONSE in value;
