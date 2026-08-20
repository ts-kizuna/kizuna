import { z } from 'zod';
import { parsePath } from '@ts-kizuna/core/adapter';
import {
    isJsonMediaType,
    isSuccessStatus,
    isVoidSchema,
    readObjectShape,
    resolveResponseBody,
    resolveResponseContentType,
} from '@ts-kizuna/core/generator';
import type { RouteDefinition } from '@ts-kizuna/core';

export interface ToolInputSchema {
    shape: Record<string, z.ZodType> | undefined;
    hasParams: boolean;
    hasQuery: boolean;
    hasBody: boolean;
}

export const buildToolInputSchema = (route: RouteDefinition): ToolInputSchema => {
    const shape: Record<string, z.ZodType> = {};
    let hasParams = false;
    let hasQuery = false;
    let hasBody = false;

    const paramNames = parsePath(route.path).paramNames;
    if (paramNames.length > 0) {
        hasParams = true;
        const paramShape: Record<string, z.ZodType> = {};
        const explicitShape = (route.pathParams ? readObjectShape(route.pathParams) : undefined) as Record<string, z.ZodType> | undefined;
        for (const name of paramNames) {
            paramShape[name] = explicitShape?.[name] ?? z.string();
        }
        shape['params'] = z.object(paramShape);
    }

    if (route.query) {
        hasQuery = true;
        shape['query'] = route.query.safeParse({}).success ? route.query.optional() : route.query;
    }

    if (route.body && !isVoidSchema(route.body)) {
        hasBody = true;
        shape['body'] = route.body.safeParse(undefined).success ? route.body.optional() : route.body;
    }

    if (Object.keys(shape).length === 0) {
        return {
            shape: undefined,
            hasParams,
            hasQuery,
            hasBody,
        };
    }

    return {
        shape,
        hasParams,
        hasQuery,
        hasBody,
    };
};

/**
 * The `{ status, body }` envelope a tool returns, with `body` carrying the
 * route's JSON success bodies. A route with none gets `status` alone.
 */
export const buildToolOutputSchema = (route: RouteDefinition): z.ZodType => {
    const bodies: z.ZodType[] = [];
    let someSuccessHasNoBody = false;

    for (const status of Object.keys(route.responses)
        .map(Number)
        .sort((left, right) => left - right)) {
        if (!isSuccessStatus(status)) continue;
        const response = route.responses[status];
        if (response === undefined) continue;
        const contentType = resolveResponseContentType(response);
        if (contentType !== undefined && !isJsonMediaType(contentType)) {
            someSuccessHasNoBody = true;
            continue;
        }
        const body = resolveResponseBody(response);
        if (isVoidSchema(body)) {
            someSuccessHasNoBody = true;
            continue;
        }
        bodies.push(body);
    }

    const status = z.int().describe('The HTTP status the route answered with');

    if (bodies.length === 0) {
        return z.object({
            status,
        });
    }

    const body = bodies.length === 1 ? bodies[0]! : z.union(bodies);

    return z.object({
        status,
        body: someSuccessHasNoBody ? body.optional() : body,
    });
};
