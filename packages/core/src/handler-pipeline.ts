import type { z } from 'zod';
import { ROUTES_TAG, type RouteDefinition, type Routes, type Method } from './types.js';
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
 * How a contract renders error (4xx/5xx) responses.
 *
 * - `'problem-details'` (default) — error bodies are RFC 9457 Problem Details; the adapter
 *   auto-fills `type`/`title`/`status` and the handler supplies `detail` plus extensions.
 * - `'custom'` — error bodies are the literal declared schema, sent verbatim. Opt in with
 *   `kizuna({ problemDetails: false })`.
 */
export type ErrorMode = 'problem-details' | 'custom';

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
 * In `'problem-details'` mode, error responses (4xx/5xx) must be RFC 9457 Problem Details — a
 * schema assignable to the envelope. Anything else resolves to `never`, surfacing as a compile
 * error at the handler return / `error()` site. Success responses pass through unchanged.
 *
 * In `'custom'` mode the contract has opted out, so every response — error or not — is the
 * literal declared body with no envelope.
 */
type ApplyErrorEnvelope<Input, Status, Mode extends ErrorMode> = Mode extends 'custom'
    ? Input
    : IsErrorStatus<Status> extends true
      ? Input extends ProblemDetailsEnvelope
          ? StripProblemEnvelope<Input>
          : never
      : Input;

type HandlerBody<S, Status, Mode extends ErrorMode> = S extends z.ZodType
    ? ApplyErrorEnvelope<z.input<S>, Status, Mode>
    : S extends { body: z.ZodType }
      ? ApplyErrorEnvelope<z.input<S['body']>, Status, Mode>
      : never;

/**
 * The body type for a guard's `deny(status, body)`, derived from the contract's
 * `guardErrorSchema`. A guard denial is always an error, so the envelope rules apply as for
 * a 4xx handler body: in `'problem-details'` mode the schema must extend the RFC 9457
 * envelope and the auto-filled `type`/`title`/`status` are stripped (supply `detail` plus
 * extensions — e.g. `ProblemDetailsSchema.extend({ code })`); in `'custom'` mode the schema's
 * input is used verbatim. `unknown` when no guard schema is declared.
 */
export type GuardErrorBody<GuardError, Mode extends ErrorMode> = GuardError extends z.ZodType
    ? ApplyErrorEnvelope<z.input<GuardError>, 400, Mode>
    : unknown;

export type HandlerReturn<R extends RouteDefinition, Mode extends ErrorMode = 'problem-details'> = {
    [Status in keyof R['responses']]: {
        status: Status extends number ? Status : never;
        body: HandlerBody<R['responses'][Status], Status, Mode>;
        headers?: Record<string, string>;
    };
}[keyof R['responses']];

export type HandlerArgs<R extends RouteDefinition, Mode extends ErrorMode = 'problem-details'> = {
    params: R extends { pathParams: z.ZodType } ? z.output<R['pathParams']> : ExtractPathParams<R['path']>;
    query: R extends { query: z.ZodType } ? z.output<R['query']> : undefined;
    body: R extends { body: z.ZodType } ? z.output<R['body']> : undefined;
    headers: R extends { headers: z.ZodType } ? z.output<R['headers']> : Record<string, string | string[] | undefined>;
    /**
     * Throws a typed error response. Takes the same `{ status, body }` shape as a handler return.
     *
     * This function throws internally and never returns.
     */
    error: (response: HandlerReturn<R, Mode>) => never;
};

export type RouteHandler<R extends RouteDefinition, HandlerContext = unknown, Mode extends ErrorMode = 'problem-details'> = (
    args: HandlerArgs<R, Mode> & HandlerContext
) => Promise<HandlerReturn<R, Mode>> | HandlerReturn<R, Mode>;

export type Router<T extends Routes, HandlerContext = unknown, Mode extends ErrorMode = 'problem-details'> = {
    [Key in keyof T as Key extends symbol ? never : Key]: T[Key] extends RouteDefinition
        ? RouteHandler<T[Key], HandlerContext, Mode>
        : T[Key] extends Routes
          ? Router<T[Key], HandlerContext, Mode>
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
    routeTags: string[];
}

export const flattenRoutes = (routes: Routes, prefix?: string, inheritedTags: string[] = []): FlattenedRoute[] => {
    const ownTag = (routes as Record<typeof ROUTES_TAG, string | undefined>)[ROUTES_TAG];
    const activeTags = ownTag ? [...inheritedTags, ownTag] : inheritedTags;
    const collected: FlattenedRoute[] = [];
    for (const [key, value] of Object.entries(routes)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (isRouteDefinition(value)) {
            collected.push({
                routeKey: fullKey,
                route: value,
                routeTags: activeTags,
            });
        } else if (value && typeof value === 'object') {
            collected.push(...flattenRoutes(value as Routes, fullKey, activeTags));
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

export const allowedMethodsForPath = (routes: Routes, path: string): Method[] => {
    const methods = new Set<Method>();
    for (const { route } of flattenRoutes(routes)) {
        if (route.path === path) methods.add(route.method);
    }
    return Array.from(methods);
};
