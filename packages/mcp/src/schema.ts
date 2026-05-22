import { z } from 'zod';
import { parsePath } from '@ts-kizuna/core';
import type { RouteDefinition } from '@ts-kizuna/core';

const isVoidSchema = (schema: z.ZodType): boolean => {
    const def = schema as unknown as { _def?: { type?: string }; def?: { type?: string } };
    return def._def?.type === 'void' || def.def?.type === 'void';
};

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
        const explicitShape = (route.pathParams as unknown as { shape?: Record<string, z.ZodType> })?.shape;
        for (const name of paramNames) {
            paramShape[name] = explicitShape?.[name] ?? z.string();
        }
        shape['params'] = z.object(paramShape);
    }

    if (route.query) {
        hasQuery = true;
        shape['query'] = route.query;
    }

    if (route.body && !isVoidSchema(route.body)) {
        hasBody = true;
        shape['body'] = route.body;
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
