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
 * A response: either a schema for the body, or an object declaring the body
 * schema with optional response `headers` and `contentType`.
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
      };

export interface RouteDefinition<TagKeys extends string = string> {
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
    security?: Array<Record<string, string[]>>;
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
 * Key under which a contract's routes carry the Problem Details opt-out marker.
 * Stamped (as `false`) by `k.contract` when the API is created with
 * `kizuna({ problemDetails: false })`. Absent or `true` means error responses use
 * RFC 9457 Problem Details; `false` means handler-authored error bodies (and guard
 * denials) are sent as the literal declared shape. The runtime renderer and the
 * OpenAPI generator read it. A symbol key, so it never appears in route iteration.
 */
export const PROBLEM_DETAILS_META: unique symbol = Symbol('ts-kizuna.problem-details');

export interface Routes<TagKeys extends string = string> {
    [ROUTES_TAG]?: string;
    [key: string]: RouteDefinition<TagKeys> | Routes<TagKeys>;
}
