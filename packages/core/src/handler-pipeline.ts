import type { z } from 'zod';
import { CONTRACT_TAG, type RouteDefinition, type Contract, type Method } from './types.js';
import type { ExtractPathParams } from './path-params.js';
import { readDef, readObjectShape, WRAPPER_TYPES } from './zod-internals.js';

const resolveBaseType = (schema: z.core.$ZodType): string => {
    const def = readDef(schema);
    if (def.type && WRAPPER_TYPES.has(def.type) && def.innerType) {
        return resolveBaseType(def.innerType);
    }
    if (def.type === 'pipe' && def.in) {
        return resolveBaseType(def.in);
    }
    return def.type ?? '';
};

const resolveArrayElement = (schema: z.core.$ZodType): z.core.$ZodType | undefined => {
    const def = readDef(schema);
    if (def.type === 'array' && def.element) {
        return def.element;
    }
    if (def.type && WRAPPER_TYPES.has(def.type) && def.innerType) {
        return resolveArrayElement(def.innerType);
    }
    if (def.type === 'pipe' && def.in) {
        return resolveArrayElement(def.in);
    }
    return undefined;
};

const coerceValue = (value: unknown, baseType: string): unknown => {
    if (typeof value !== 'string') return value;
    if (baseType === 'number' || baseType === 'int') {
        const coerced = Number(value);
        return Number.isNaN(coerced) ? value : coerced;
    }
    if (baseType === 'boolean') {
        if (value === 'true') return true;
        if (value === 'false') return false;
    }
    if (baseType === 'bigint') {
        try {
            return BigInt(value);
        } catch {
            // Invalid bigint — leave it for Zod to reject.
            return value;
        }
    }
    if (baseType === 'date') {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? value : date;
    }
    return value;
};

const coerceStringValues = (input: unknown, schema: z.ZodType): unknown => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
    const shape = readObjectShape(schema);
    if (!shape) return input;
    const record = input as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    let changed = false;
    for (const key of Object.keys(record)) {
        const fieldSchema = shape[key];
        if (!fieldSchema) {
            result[key] = record[key];
            continue;
        }
        const baseType = resolveBaseType(fieldSchema);
        if (baseType === 'array') {
            const elementSchema = resolveArrayElement(fieldSchema);
            if (elementSchema && Array.isArray(record[key])) {
                const elementType = resolveBaseType(elementSchema);
                const coerced = (record[key] as unknown[]).map((item) => coerceValue(item, elementType));
                result[key] = coerced;
                changed = true;
            } else {
                result[key] = record[key];
            }
        } else {
            const coerced = coerceValue(record[key], baseType);
            result[key] = coerced;
            if (coerced !== record[key]) changed = true;
        }
    }
    return changed ? result : input;
};

type ProblemDetailsEnvelope = { type: string; title: string; status: number; detail: string };

/**
 * Strips the RFC 9457 envelope fields the adapter auto-fills (`type`/`title`/`status`),
 * leaving the author to supply `detail` plus any extension members. `type` stays optional
 * (authors may point it at their own problem-type URI); `title`/`status` are forbidden.
 */
type StripProblemEnvelope<T extends ProblemDetailsEnvelope> = Omit<T, 'type' | 'title' | 'status'> &
    Partial<Pick<T, 'type'>> & { title?: never; status?: never };

/**
 * True when a literal status key is in the 4xx/5xx range. Widened `number` keys (no
 * `const` inference) resolve to `false`, so enforcement only kicks in when the concrete
 * status is known — exactly where the wire output matters.
 */
type IsErrorStatus<Status> = `${Status & number}` extends `4${string}` | `5${string}` ? true : false;

/**
 * Error responses (4xx/5xx) must be RFC 9457 Problem Details — a schema assignable to the
 * envelope. Anything else resolves to `never`, surfacing as a compile error at the handler
 * return / `error()` site. Success responses pass through unchanged.
 */
type ApplyErrorEnvelope<Input, Status> =
    IsErrorStatus<Status> extends true ? (Input extends ProblemDetailsEnvelope ? StripProblemEnvelope<Input> : never) : Input;

type HandlerBody<S, Status> = S extends z.ZodType
    ? ApplyErrorEnvelope<z.input<S>, Status>
    : S extends { body: z.ZodType }
      ? ApplyErrorEnvelope<z.input<S['body']>, Status>
      : never;

export type HandlerReturn<R extends RouteDefinition> = {
    [Status in keyof R['responses']]: {
        status: Status extends number ? Status : never;
        body: HandlerBody<R['responses'][Status], Status>;
        headers?: Record<string, string>;
    };
}[keyof R['responses']];

export type HandlerArgs<R extends RouteDefinition> = {
    params: R extends { pathParams: z.ZodType } ? z.output<R['pathParams']> : ExtractPathParams<R['path']>;
    query: R extends { query: z.ZodType } ? z.output<R['query']> : undefined;
    body: R extends { body: z.ZodType } ? z.output<R['body']> : undefined;
    headers: R extends { headers: z.ZodType } ? z.output<R['headers']> : Record<string, string | string[] | undefined>;
    /**
     * Throws a typed error response. Takes the same `{ status, body }` shape as a handler return.
     *
     * This function throws internally and never returns.
     */
    error: (response: HandlerReturn<R>) => never;
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

const COERCED_STAGES: ReadonlySet<ValidationStage> = new Set(['params', 'query', 'headers']);

const STAGE_MESSAGES: Record<ValidationStage, string> = {
    params: 'Invalid path parameters',
    query: 'Invalid query parameters',
    headers: 'Invalid headers',
    body: 'Invalid request body',
};

export const formatValidationError = (failure: ValidationFailure): { detail: string; issues: z.core.$ZodIssue[] } => ({
    detail: STAGE_MESSAGES[failure.stage],
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
        const input = COERCED_STAGES.has(step.stage) ? coerceStringValues(step.input, step.schema) : step.input;
        const result = step.schema.safeParse(input);
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
