import type { z } from 'zod';
import type { RouteDefinition, Contract, ValidationError } from '@ts-kizuna/core';
import type { ExtractPathParams, HasPathParams } from '@ts-kizuna/core';
import { buildPath, isRouteDefinition } from '@ts-kizuna/core';

type ResponseUnion<R extends RouteDefinition> = {
    [S in keyof R['responses']]: {
        status: S extends number ? S : never;
        body: R['responses'][S] extends z.ZodType
            ? z.infer<R['responses'][S]>
            : R['responses'][S] extends { body: z.ZodType }
              ? z.infer<R['responses'][S]['body']>
              : never;
        headers: R['responses'][S] extends { headers: z.ZodType } ? z.infer<R['responses'][S]['headers']> : Record<string, string>;
    };
}[keyof R['responses']];

type SubstituteUnknownInBranch<In, Out> = [In] extends [readonly unknown[]]
    ? [Out] extends [readonly unknown[]]
        ? { [K in keyof In]: K extends keyof Out ? (unknown extends In[K] ? Out[K] : SubstituteUnknown<In[K], Out[K]>) : In[K] }
        : In
    : [In] extends [Record<string, unknown>]
      ? [Out] extends [Record<string, unknown>]
          ? { [K in keyof In]: K extends keyof Out ? (unknown extends In[K] ? Out[K] : SubstituteUnknown<In[K], Out[K]>) : In[K] }
          : In
      : unknown extends In
        ? Out
        : In;

type SubstituteUnknown<In, Out> = In extends unknown
    ? SubstituteUnknownInBranch<In, Extract<Out, In> extends never ? Out : Extract<Out, In>>
    : never;

type ClientPayload<T extends z.ZodType> = SubstituteUnknown<z.input<T>, z.output<T>>;

type ClientArgs<R extends RouteDefinition> = (HasPathParams<R['path']> extends true ? { params: ExtractPathParams<R['path']> } : {}) &
    (R extends { body: z.ZodType } ? (ClientPayload<R['body']> extends void ? {} : { body: ClientPayload<R['body']> }) : {}) &
    (R extends { query: z.ZodType }
        ? {} extends ClientPayload<R['query']>
            ? { query?: ClientPayload<R['query']> }
            : { query: ClientPayload<R['query']> }
        : {}) &
    (R extends { headers: z.ZodType } ? { headers: ClientPayload<R['headers']> } : { headers?: Record<string, string> }) & {
        fetchOptions?: RequestInit;
    };

type ValidationErrorResult = {
    status: 400;
    body: ValidationError;
    headers: Record<string, string>;
};

type HasValidation<R extends RouteDefinition> = R extends { body: z.ZodType } ? true : R extends { query: z.ZodType } ? true : false;

type ClientResponse<R extends RouteDefinition> =
    HasValidation<R> extends true ? ResponseUnion<R> | ValidationErrorResult : ResponseUnion<R>;

type ClientFn<R extends RouteDefinition> =
    {} extends ClientArgs<R> ? (args?: ClientArgs<R>) => Promise<ClientResponse<R>> : (args: ClientArgs<R>) => Promise<ClientResponse<R>>;

export type Client<T extends Contract> = {
    [K in keyof T]: T[K] extends RouteDefinition ? ClientFn<T[K]> : T[K] extends Contract ? Client<T[K]> : never;
};

export interface RequestContext {
    url: string;
    method: string;
    headers: Headers;
    route: RouteDefinition;
}

export interface ClientConfig {
    baseUrl: string;
    baseHeaders?: Record<string, string>;
    credentials?: RequestCredentials;
    fetch?: typeof fetch;
    onRequest?: (context: RequestContext) => void | Promise<void>;
}

const buildFormData = (body: Record<string, unknown>): FormData => {
    const formData = new FormData();
    for (const [key, entry] of Object.entries(body)) {
        const values = Array.isArray(entry) ? entry : [entry];
        for (const value of values) {
            if (value instanceof File || value instanceof Blob) {
                formData.append(key, value);
            } else if (value !== undefined && value !== null) {
                formData.append(key, typeof value === 'string' ? value : JSON.stringify(value));
            }
        }
    }
    return formData;
};

const buildQueryString = (query: Record<string, unknown>): string => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
            for (const item of value) params.append(key, String(item));
        } else {
            params.append(key, String(value));
        }
    }
    const result = params.toString();
    return result.length > 0 ? `?${result}` : '';
};

const buildRouteFn = (route: RouteDefinition, config: ClientConfig) => {
    return async (
        args: {
            params?: Record<string, string | number>;
            query?: Record<string, unknown>;
            body?: unknown;
            headers?: Record<string, string>;
            fetchOptions?: RequestInit;
        } = {}
    ) => {
        const url = config.baseUrl + buildPath(route.path, args.params) + (args.query ? buildQueryString(args.query) : '');
        const headers: Record<string, string> = {
            ...(config.baseHeaders ?? {}),
            ...(args.headers ?? {}),
        };
        let body: string | FormData | URLSearchParams | undefined;
        if (args.body !== undefined) {
            const hasContentTypeHeader = 'Content-Type' in headers || 'content-type' in headers;
            switch (route.contentType) {
                case 'multipart/form-data':
                    body = args.body instanceof FormData ? args.body : buildFormData(args.body as Record<string, unknown>);
                    break;
                case 'application/x-www-form-urlencoded':
                    if (!hasContentTypeHeader) headers['Content-Type'] = 'application/x-www-form-urlencoded';
                    body = new URLSearchParams(args.body as Record<string, string>);
                    break;
                default:
                    if (!hasContentTypeHeader) headers['Content-Type'] = 'application/json';
                    body = JSON.stringify(args.body);
            }
        }
        const requestHeaders = new Headers(headers);
        if (config.onRequest) {
            await config.onRequest({ url, method: route.method, headers: requestHeaders, route });
        }
        const fetchFn = config.fetch ?? fetch;
        const res = await fetchFn(url, {
            method: route.method,
            headers: requestHeaders,
            body,
            credentials: config.credentials,
            ...args.fetchOptions,
        });
        const text = await res.text();
        let parsed: unknown;
        try {
            parsed = text.length > 0 ? JSON.parse(text) : undefined;
        } catch {
            parsed = text;
        }
        const responseHeaders: Record<string, string> = {};
        res.headers.forEach((value, key) => {
            responseHeaders[key] = value;
        });
        return {
            status: res.status,
            body: parsed,
            headers: responseHeaders,
        };
    };
};

const buildClientTree = (router: Contract, config: ClientConfig): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(router)) {
        const node = router[key];
        if (isRouteDefinition(node)) {
            result[key] = buildRouteFn(node, config);
        } else if (node && typeof node === 'object') {
            result[key] = buildClientTree(node as Contract, config);
        }
    }
    return result;
};

/**
 * Create a fully-typed fetch client from a contract.
 *
 * ```ts
 * // lib/api-client.ts
 * import { createClient } from '@ts-kizuna/fetch';
 * import { contract } from './contract';
 *
 * export const apiClient = createClient(contract, {
 *     baseUrl: 'https://api.example.com',
 *     baseHeaders: { Authorization: `Bearer ${token}` },
 * });
 *
 * // anywhere in your app
 * const { status, body } = await apiClient.createUser({
 *     body: { name: 'Alice', email: 'alice@example.com' },
 * });
 * if (status === 201) console.log(body.id);
 * ```
 */
export const createClient = <T extends Contract>(contract: T, config: ClientConfig): Client<T> => {
    return buildClientTree(contract, config) as Client<T>;
};
