import type { z } from 'zod';

export type Method = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

/**
 * The `Content-Type` of a response body. The listed values are suggestions;
 * any media type string is accepted.
 */
export type ResponseContentType =
    | 'application/json'
    | 'application/problem+json'
    | 'application/octet-stream'
    | 'application/pdf'
    | 'application/xml'
    | 'application/zip'
    | 'text/plain'
    | 'text/html'
    | 'text/csv'
    | 'text/markdown'
    | 'text/calendar'
    | 'image/png'
    | 'image/jpeg'
    | 'image/svg+xml'
    | 'image/webp'
    | (string & {});

/**
 * The wire format of a streaming response. `'sse'` is Server-Sent Events
 * (`text/event-stream`).
 *
 * @see https://html.spec.whatwg.org/multipage/server-sent-events.html
 */
export type StreamFormat = 'sse';

/**
 * A streaming response: a sequence of events over one open connection instead of
 * a single materialized body. The handler returns `{ status, stream }` rather
 * than `{ status, body }`, and generated clients expose the events as a typed
 * async sequence.
 *
 * @example
 * ```ts
 * const ActivityEventSchema = z.discriminatedUnion('type', [
 *     z.object({ type: z.literal('progress'), percent: z.number() }),
 *     z.object({ type: z.literal('done') }),
 * ]);
 *
 * streamActivity: {
 *     method: 'POST',
 *     path: '/users/:id/activity',
 *     responses: {
 *         200: {
 *             stream: 'sse',
 *             event: ActivityEventSchema,
 *             eventName: 'type',
 *         },
 *     },
 * }
 * ```
 */
export interface StreamResponseDefinition {
    /**
     * The wire format, which determines the `Content-Type`.
     */
    stream: StreamFormat;
    /**
     * Schema for a single event, not for the stream as a whole.
     */
    event: z.ZodType;
    /**
     * The field of `event` whose value names the SSE `event:` line, letting
     * browser clients use `addEventListener(name)`. Typically the discriminant
     * of a `z.discriminatedUnion`. Omit to send unnamed events.
     */
    eventName?: string;
    /**
     * Schema for the response headers. Each property becomes one response
     * header, sent before the first event.
     */
    headers?: z.ZodType;
    contentType?: never;
    body?: never;
}

/**
 * A response: a schema for the body, an object declaring the body schema with
 * optional response `headers` and `contentType`, or a
 * {@link StreamResponseDefinition} for a streaming response.
 */
export type ResponseDefinition =
    | z.ZodType
    | {
          /**
           * Schema for the response body.
           */
          body: z.ZodType;
          /**
           * Schema for the response headers. Each property becomes one
           * response header.
           */
          headers?: z.ZodType;
          /**
           * The `Content-Type` of this response.
           *
           * @default 'application/json'
           */
          contentType?: ResponseContentType;
          stream?: never;
          event?: never;
      }
    | StreamResponseDefinition;

/**
 * A single security requirement on a route: either a scheme name (sugar for the
 * scheme with no scopes) or a map of scheme name → required scopes. Mirrors an
 * entry of OpenAPI's `operation.security` array.
 *
 * ```ts
 * security: ['user']                  // just authenticated
 * security: [{ user: ['admin'] }]     // authenticated AND has the admin scope
 * ```
 */
export type SecurityRequirement<SchemeNames extends string = string> = SchemeNames | { [Name in SchemeNames]?: readonly string[] };

/**
 * The scheme name(s) a {@link SecurityRequirement} entry references.
 */
export type SchemeNameOf<Entry> = Entry extends string ? Entry : Extract<keyof Entry, string>;

/**
 * A route's resolved access gate, produced by `k.contract` from the `auth` map.
 * Keyed by identity name, then by access field, mapping to the allowed value or
 * values. Adapters deny requests whose field value is not allowed and narrow the
 * field in the handler args. An empty object requires authentication with no
 * field constraint.
 */
export type AccessGate = Record<string, Record<string, unknown>>;

export interface RouteDefinition<TagKeys extends string = string, SchemeNames extends string = string> {
    method: Method;
    /**
     * Route path starting with `/`. Use `:paramName` for path parameters.
     *
     * Note: paths are matched exactly per RFC 3986 — `/users/1` and `/users/1/` are distinct resources.
     */
    path: `/${string}`;
    summary?: string;
    description?: string;
    /**
     * Tag keys grouping this route in the OpenAPI spec. Keys come from the tag set
     * declared with `createTags`; `k.routes` stamps the group's tag onto every
     * route, and the generator resolves each key to its `title` for the spec.
     */
    tags?: readonly TagKeys[];
    /**
     * The security schemes this route requires, referencing identities registered
     * on the `kizuna` factory. Each entry is a scheme name or a `{ scheme: scopes }`
     * map. Set by `k.contract` from the `auth` map; `[]` marks the route public.
     */
    security?: readonly SecurityRequirement<SchemeNames>[];
    /**
     * The route's resolved access gate, set by `k.contract` from the `auth` map's
     * `{ scheme: { field: value } }` constraints. See {@link AccessGate}.
     */
    accessGate?: AccessGate;
    externalDocs?: {
        url: string;
        description?: string;
    };
    contentType?: 'application/json' | 'multipart/form-data' | 'application/x-www-form-urlencoded';
    body?: z.ZodType;
    query?: z.ZodType;
    pathParams?: z.ZodType;
    headers?: z.ZodType;
    /**
     * Responses keyed by HTTP status code. Each value is either a schema for
     * the body, or an object declaring the body schema with optional response
     * `headers` and `contentType`.
     *
     * @example
     * ```ts
     * responses: {
     *     // Bare schema — the response body, sent as application/json
     *     200: UserSchema,
     *     // Object form — body plus headers and/or a non-default content type
     *     201: {
     *         body: UserSchema,
     *         headers: z.object({ 'x-request-id': z.string() }),
     *         contentType: 'application/json',
     *     },
     * }
     * ```
     */
    responses: {
        [status: number]: ResponseDefinition;
    };
}

/**
 * Key under which a routes group carries its group tag key — the source
 * `flattenRoutes` and the generator use to apply the group's tag to every route
 * in it. Stamped by `k.routes`.
 */
export const ROUTES_TAG: unique symbol = Symbol('ts-kizuna.routes.tag');

/**
 * Type-only key under which `k.contract` brands each route with its resolved
 * handler context. Never written at runtime.
 */
export const HANDLER_CONTEXT_BRAND: unique symbol = Symbol('ts-kizuna.route.handlerContext');

export interface HandlerContextBrand<Context> {
    readonly [HANDLER_CONTEXT_BRAND]?: Context;
}

export interface Routes<TagKeys extends string = string, SchemeNames extends string = string> {
    [ROUTES_TAG]?: string;
    [key: string]: RouteDefinition<TagKeys, SchemeNames> | Routes<TagKeys, SchemeNames>;
}

/**
 * A route as authored in `k.routes`: the route shape minus `security` and
 * `accessGate`, which the `auth` map owns and `k.contract` resolves. Writing
 * either on a route is a type error.
 */
export type AuthoredRouteDefinition<TagKeys extends string = string> = Omit<RouteDefinition<TagKeys>, 'security' | 'accessGate'> & {
    security?: never;
    accessGate?: never;
};

/**
 * A tree of {@link AuthoredRouteDefinition}s, the shape `k.routes` accepts.
 */
export interface AuthoredRoutes<TagKeys extends string = string> {
    [ROUTES_TAG]?: string;
    [key: string]: AuthoredRouteDefinition<TagKeys> | AuthoredRoutes<TagKeys>;
}
