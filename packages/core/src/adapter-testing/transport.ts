export type TestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface TestRequest {
    method: TestMethod;
    path: string;
    /**
     * A string is sent as-is, a `FormData` is multipart-encoded, anything else
     * is JSON-serialized.
     */
    body?: unknown;
    headers?: Record<string, string>;
}

/**
 * A request as an adapter receives it: body already serialized, headers already carrying the content type.
 */
export interface MountRequest {
    method: TestMethod;
    path: string;
    body: string | Uint8Array<ArrayBuffer> | undefined;
    headers: Record<string, string>;
}

export interface TestResponse {
    status: number;
    headers: Headers;
    body: unknown;
    /**
     * Raw text, for the declared-contentType and void-body tests where the parsed body is not enough.
     */
    text: string;
}

/**
 * How to talk to one mounted adapter. The only genuinely framework-specific part of a suite.
 */
export interface Transport {
    request: (request: MountRequest) => Promise<TestResponse>;
    close?: () => Promise<void>;
}

export interface MountedApi {
    request: (request: TestRequest) => Promise<TestResponse>;
    close?: () => Promise<void>;
}

/**
 * Falls back to raw text because a framework's own error pages (Hono's 404, for one) are not JSON.
 */
export const readTestBody = (text: string): unknown => {
    if (text.length === 0) return undefined;
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return text;
    }
};

const resolveRequest = async ({ method, path, body, headers }: TestRequest): Promise<MountRequest> => {
    if (body === undefined) {
        return {
            method,
            path,
            body: undefined,
            headers: headers ?? {},
        };
    }
    if (body instanceof FormData) {
        // Response mints the boundary-carrying content type.
        const encoded = new Response(body);
        return {
            method,
            path,
            body: new Uint8Array(await encoded.arrayBuffer()),
            headers: {
                'content-type': encoded.headers.get('content-type') ?? 'multipart/form-data',
                ...headers,
            },
        };
    }
    return {
        method,
        path,
        body: typeof body === 'string' ? body : JSON.stringify(body),
        // A test that sets its own content type wins, which the 415 feature relies on.
        headers: {
            'content-type': 'application/json',
            ...headers,
        },
    };
};

export const toMountedApi = (transport: Transport): MountedApi => ({
    request: async (request) => transport.request(await resolveRequest(request)),
    close: transport.close,
});
