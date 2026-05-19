import type { z } from 'zod';
import { CONTRACT_TAG, type RouteDefinition, type Contract, type Method } from './types.js';
import type { ExtractPathParams } from './path-params.js';

export type HandlerReturn<R extends RouteDefinition> = {
    [Status in keyof R['responses']]: {
        status: Status extends number ? Status : never;
        body: R['responses'][Status] extends z.ZodType
            ? z.input<R['responses'][Status]>
            : R['responses'][Status] extends { body: z.ZodType }
              ? z.input<R['responses'][Status]['body']>
              : never;
        headers?: Record<string, string>;
    };
}[keyof R['responses']];

export type HandlerArgs<R extends RouteDefinition> = {
    params: R extends { pathParams: z.ZodType } ? z.output<R['pathParams']> : ExtractPathParams<R['path']>;
    query: R extends { query: z.ZodType } ? z.output<R['query']> : undefined;
    body: R extends { body: z.ZodType } ? z.output<R['body']> : undefined;
    headers: R extends { headers: z.ZodType } ? z.output<R['headers']> : Record<string, string | string[] | undefined>;
};

export type RouteHandler<R extends RouteDefinition, HandlerContext = unknown> = (
    args: HandlerArgs<R> & HandlerContext
) => Promise<HandlerReturn<R>> | HandlerReturn<R>;

export type Router<T extends Contract, HandlerContext = unknown> = {
    [Key in keyof T as Key extends symbol ? never : Key]: T[Key] extends RouteDefinition
        ? RouteHandler<T[Key], HandlerContext>
        : T[Key] extends Contract
          ? Router<T[Key], HandlerContext>
          : never;
};

export const isRouteDefinition = (value: unknown): value is RouteDefinition => {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Record<string, unknown>;
    return typeof candidate.method === 'string' && typeof candidate.path === 'string' && !!candidate.responses;
};

export interface FlattenedRoute {
    routeKey: string;
    route: RouteDefinition;
    contractTags: string[];
}

export const flattenContract = (contract: Contract, prefix?: string, inheritedTags: string[] = []): FlattenedRoute[] => {
    const ownTag = (contract as Record<typeof CONTRACT_TAG, string | undefined>)[CONTRACT_TAG];
    const activeTags = ownTag ? [...inheritedTags, ownTag] : inheritedTags;
    const collected: FlattenedRoute[] = [];
    for (const [key, value] of Object.entries(contract)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (isRouteDefinition(value)) {
            collected.push({
                routeKey: fullKey,
                route: value,
                contractTags: activeTags,
            });
        } else if (value && typeof value === 'object') {
            collected.push(...flattenContract(value as Contract, fullKey, activeTags));
        }
    }
    return collected;
};

export interface RawInputs {
    params: unknown;
    query: unknown;
    body: unknown;
    headers: unknown;
}

export type ValidationStage = 'params' | 'query' | 'headers' | 'body';

export interface ValidationFailure {
    stage: ValidationStage;
    issues: z.core.$ZodIssue[];
}

const STAGE_MESSAGES: Record<ValidationStage, string> = {
    params: 'Invalid path parameters',
    query: 'Invalid query parameters',
    headers: 'Invalid headers',
    body: 'Invalid request body',
};

export const formatValidationError = (failure: ValidationFailure): { message: string; issues: z.core.$ZodIssue[] } => ({
    message: STAGE_MESSAGES[failure.stage],
    issues: failure.issues,
});

export const validateRequest = (
    route: RouteDefinition,
    raw: RawInputs
): { ok: true; parsed: RawInputs } | { ok: false; error: ValidationFailure } => {
    const order: ReadonlyArray<{ stage: ValidationStage; schema: z.ZodType | undefined; input: unknown }> = [
        {
            stage: 'params',
            schema: route.pathParams,
            input: raw.params,
        },
        {
            stage: 'query',
            schema: route.query,
            input: raw.query,
        },
        {
            stage: 'headers',
            schema: route.headers,
            input: raw.headers,
        },
        {
            stage: 'body',
            schema: route.body,
            input: raw.body,
        },
    ];

    const parsed: RawInputs = {
        params: raw.params,
        query: raw.query,
        headers: raw.headers,
        body: raw.body,
    };

    for (const step of order) {
        if (!step.schema) continue;
        const result = step.schema.safeParse(step.input);
        if (!result.success) {
            return {
                ok: false,
                error: {
                    stage: step.stage,
                    issues: result.error.issues,
                },
            };
        }
        parsed[step.stage] = result.data;
    }

    return {
        ok: true,
        parsed,
    };
};

export const allowedMethodsForPath = (contract: Contract, path: string): Method[] => {
    const methods = new Set<Method>();
    for (const { route } of flattenContract(contract)) {
        if (route.path === path) methods.add(route.method);
    }
    return Array.from(methods);
};
