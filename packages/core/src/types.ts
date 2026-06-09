import type { z } from 'zod';
import type { Tag } from './tag.js';

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

export interface RouteDefinition {
    method: Method;
    /**
     * Route path starting with `/`. Use `:paramName` for path parameters.
     *
     * Note: paths are matched exactly per RFC 3986 — `/users/1` and `/users/1/` are distinct resources.
     */
    path: `/${string}`;
    summary?: string;
    description?: string;
    tags?: readonly Tag[];
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

export const CONTRACT_TAG: unique symbol = Symbol('ts-kizuna.contract.tag');
export const CONTRACT_DESCRIPTION: unique symbol = Symbol('ts-kizuna.contract.description');

export interface Contract {
    [CONTRACT_TAG]?: string;
    [CONTRACT_DESCRIPTION]?: string;
    [key: string]: RouteDefinition | Contract;
}
