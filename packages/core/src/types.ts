import type { z } from 'zod';

export type Method = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

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
    tags?: string[];
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
    responses: {
        [status: number]: z.ZodType | { body: z.ZodType; headers?: z.ZodType };
    };
}

export const CONTRACT_TAG: unique symbol = Symbol('ts-kizuna.contract.tag');

export interface Contract {
    [CONTRACT_TAG]?: string;
    [key: string]: RouteDefinition | Contract;
}
