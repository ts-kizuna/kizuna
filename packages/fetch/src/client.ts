import type { z } from 'zod';
import type {
    RouteDefinition,
    Routes,
    ValidationError,
    ValidationErrorFor,
    Contract,
    TagOptions,
    RequestContextSchema,
    RequestContextHeaderInputs,
    SecurityScheme,
    CredentialSink,
    CredentialValue,
    CredentialProvider,
    ClientAuth,
} from '@ts-kizuna/core';
import type { ExtractPathParams, HasPathParams } from '@ts-kizuna/core';
import { buildPath, isRouteDefinition, placeCredential, resolveSecurityRequirements } from '@ts-kizuna/core';

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

/**
 * The type a caller passes for a body, query, or headers argument — the schema's
 * input type.
 */
type ClientPayload<T extends z.ZodType> = z.input<T>;

/**
 * Path params are typed from the route's `pathParams` schema output when one is declared,
 * mirroring the server-side `HandlerArgs`. This makes refinements like `.brand()` flow to
 * the caller. Falls back to the path template (`:param` → `string`).
 */
type ClientParams<R extends RouteDefinition> = R extends { pathParams: z.ZodType }
    ? z.output<R['pathParams']>
    : ExtractPathParams<R['path']>;

type ClientArgs<R extends RouteDefinition> = (HasPathParams<R['path']> extends true ? { params: ClientParams<R> } : {}) &
    (R extends { body: z.ZodType } ? (ClientPayload<R['body']> extends void ? {} : { body: ClientPayload<R['body']> }) : {}) &
    (R extends { query: z.ZodType }
        ? {} extends ClientPayload<R['query']>
            ? { query?: ClientPayload<R['query']> }
            : { query: ClientPayload<R['query']> }
        : {}) &
    (R extends { headers: z.ZodType } ? { headers: ClientPayload<R['headers']> } : { headers?: Record<string, string> }) & {
        fetchOptions?: RequestInit;
    };

type ValidationErrorResult<Codes extends string> = {
    status: 400;
    // No custom codes declared → exactly `ValidationError`, so the common case
    // keeps its existing type; otherwise widen `code` with the configured codes.
    body: [Codes] extends [never] ? ValidationError : ValidationErrorFor<Codes>;
    headers: Record<string, string>;
};

type HasValidation<R extends RouteDefinition> = R extends { body: z.ZodType } ? true : R extends { query: z.ZodType } ? true : false;

type ClientResponse<R extends RouteDefinition, Codes extends string> =
    HasValidation<R> extends true ? ResponseUnion<R> | ValidationErrorResult<Codes> : ResponseUnion<R>;

type ClientFn<R extends RouteDefinition, Codes extends string> =
    {} extends ClientArgs<R>
        ? (args?: ClientArgs<R>) => Promise<ClientResponse<R, Codes>>
        : (args: ClientArgs<R>) => Promise<ClientResponse<R, Codes>>;

export type Client<T extends Routes, Codes extends string = never> = {
    [K in keyof T]: T[K] extends RouteDefinition ? ClientFn<T[K], Codes> : T[K] extends Routes ? Client<T[K], Codes> : never;
};

type UnionToIntersection<Union> = (Union extends unknown ? (distributed: Union) => void : never) extends (
    intersected: infer Intersection
) => void
    ? Intersection
    : never;

/**
 * Every header input the contract's request context declares, flattened. Set
 * once on `createClient` under `requestContext` and sent with every request.
 */
type ContextHeaderInputs<Declarations> = string extends keyof Declarations
    ? {}
    : [keyof Declarations] extends [never]
      ? {}
      : UnionToIntersection<
              {
                  [Name in keyof Declarations]: RequestContextHeaderInputs<Declarations[Name]>;
              }[keyof Declarations]
          > extends infer Merged
        ? { [Key in keyof Merged]: Merged[Key] }
        : never;

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

interface ResolvedClientConfig extends ClientConfig {
    auth?: Record<string, CredentialProvider<CredentialValue>>;
    securitySchemes?: Record<string, SecurityScheme>;
}

const applyCredentials = async (
    route: RouteDefinition,
    config: ResolvedClientConfig,
    headers: Record<string, string>,
    query: Record<string, string>
): Promise<void> => {
    const { auth, securitySchemes } = config;
    if (!auth || !securitySchemes || !route.security?.length) return;
    const sink: CredentialSink = {
        header: (name, value) => {
            if (name.toLowerCase() === 'cookie' && headers['Cookie']) headers['Cookie'] = `${headers['Cookie']}; ${value}`;
            else headers[name] = value;
        },
        query: (name, value) => {
            query[name] = value;
        },
    };
    for (const { scheme } of resolveSecurityRequirements(route)) {
        const identity = securitySchemes[scheme];
        const provider = auth[scheme];
        if (!identity || !provider) continue;
        const value = await provider();
        if (value === null || value === undefined) continue;
        placeCredential(identity, value, sink);
    }
};

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

/**
 * Serializes a query or path value for the URL. Dates use ISO 8601; everything
 * else uses `String`.
 */
const serializeValue = (value: unknown): string => (value instanceof Date ? value.toISOString() : String(value));

const buildQueryString = (query: Record<string, unknown>): string => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
            for (const item of value) params.append(key, serializeValue(item));
        } else {
            params.append(key, serializeValue(value));
        }
    }
    const result = params.toString();
    return result.length > 0 ? `?${result}` : '';
};

const buildRouteFn = (route: RouteDefinition, config: ResolvedClientConfig) => {
    return async (
        args: {
            params?: Record<string, string | number | bigint | Date>;
            query?: Record<string, unknown>;
            body?: unknown;
            headers?: Record<string, string>;
            fetchOptions?: RequestInit;
        } = {}
    ) => {
        const authHeaders: Record<string, string> = {};
        const authQuery: Record<string, string> = {};
        await applyCredentials(route, config, authHeaders, authQuery);
        const query = { ...(args.query ?? {}), ...authQuery };
        const url = config.baseUrl + buildPath(route.path, args.params) + buildQueryString(query);
        const headers: Record<string, string> = {
            ...(config.baseHeaders ?? {}),
            ...authHeaders,
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

const buildClientTree = (router: Routes, config: ResolvedClientConfig): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(router)) {
        const node = router[key];
        if (isRouteDefinition(node)) {
            result[key] = buildRouteFn(node, config);
        } else if (node && typeof node === 'object') {
            result[key] = buildClientTree(node as Routes, config);
        }
    }
    return result;
};

/**
 * Create a typed fetch client from a contract. Each route becomes a method that
 * validates its arguments and returns the typed response. The contract's custom
 * issue codes are carried through to `errors[].code` on `400` responses.
 *
 * When the contract declares a request context with header bindings, pass their
 * values under `requestContext`; the client sends them with every request.
 *
 * When the contract secures routes with [identities](/docs/auth), register a
 * credential provider per identity under `auth`; the client attaches each route's
 * credential where the identity declares it. Providers are optional — supply the
 * ones this client holds; a scheme with no provider is not sent and the server
 * returns its typed `401`/`403`.
 *
 * @example
 * export const apiClient = createClient(contract, {
 *     baseUrl: 'https://api.example.com',
 *     auth: {
 *         user: () => getBearerToken(),
 *     },
 * });
 *
 * const { status, body } = await apiClient.orders.pay({
 *     params: {
 *         id: '1',
 *     },
 * });
 */
export function createClient<
    T extends Routes,
    Codes extends string = never,
    Schemes extends Record<string, SecurityScheme> = Record<string, never>,
    RequestContext extends Record<string, RequestContextSchema> = Record<string, never>,
>(
    contract: Contract<T, Record<string, TagOptions>, Codes, Schemes, unknown, RequestContext>,
    config: ClientConfig &
        ({} extends ContextHeaderInputs<RequestContext>
            ? { requestContext?: ContextHeaderInputs<RequestContext> }
            : { requestContext: ContextHeaderInputs<RequestContext> }) & { auth?: ClientAuth<Schemes> }
): Client<T, Codes> {
    const contextHeaders = (config as { requestContext?: Record<string, string | undefined> }).requestContext;
    const auth = (config as { auth?: Record<string, CredentialProvider<CredentialValue>> }).auth;
    const resolvedConfig: ResolvedClientConfig = {
        ...(contextHeaders
            ? {
                  ...config,
                  baseHeaders: {
                      ...Object.fromEntries(Object.entries(contextHeaders).filter(([, value]) => value !== undefined)),
                      ...(config.baseHeaders ?? {}),
                  } as Record<string, string>,
              }
            : config),
        auth,
        securitySchemes: contract.securitySchemes,
    };

    return buildClientTree(contract.routes, resolvedConfig) as Client<T, Codes>;
}
