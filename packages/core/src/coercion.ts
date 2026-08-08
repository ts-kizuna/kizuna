import type { z } from 'zod';
import type { RouteDefinition } from './types.js';
import { readDef, readObjectShape, resolveBaseType, WRAPPER_TYPES } from './zod-internals.js';

/**
 * The schema kinds a path/query/header string is coerced into. A field of any
 * other kind arrives usable as is.
 */
const COERCIBLE_TYPES: ReadonlySet<string> = new Set(['number', 'int', 'boolean', 'bigint', 'date']);

interface CoercionField {
    key: string;
    type: string;
    array: boolean;
}

/**
 * The fields of one request schema that need coercion, or `null` when none do.
 * Resolved once per schema so a request only visits fields that can change.
 */
export type CoercionPlan = CoercionField[] | null;

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

const buildCoercionPlan = (schema: z.ZodType): CoercionPlan => {
    const shape = readObjectShape(schema);
    if (!shape) return null;
    const fields: CoercionField[] = [];
    for (const [key, fieldSchema] of Object.entries(shape)) {
        const baseType = resolveBaseType(fieldSchema);
        if (baseType === 'array') {
            const element = resolveArrayElement(fieldSchema);
            const elementType = element ? resolveBaseType(element) : undefined;
            if (elementType !== undefined && COERCIBLE_TYPES.has(elementType)) {
                fields.push({
                    key,
                    type: elementType,
                    array: true,
                });
            }
            continue;
        }
        if (COERCIBLE_TYPES.has(baseType)) {
            fields.push({
                key,
                type: baseType,
                array: false,
            });
        }
    }
    return fields.length > 0 ? fields : null;
};

const plans = new WeakMap<z.ZodType, CoercionPlan>();

/**
 * The coercion plan for a request schema, built on first sight and cached
 * afterwards. {@link resolveCoercionPlans} fills the cache at startup, leaving
 * the request path a single `WeakMap` read.
 */
export const coercionPlanFor = (schema: z.ZodType): CoercionPlan => {
    const cached = plans.get(schema);
    if (cached !== undefined) return cached;
    const plan = buildCoercionPlan(schema);
    plans.set(schema, plan);
    return plan;
};

/**
 * Resolves the plans for a route's coerced schemas ahead of any request. Called
 * when a contract is defined and when an API is assembled.
 */
export const resolveCoercionPlans = (route: RouteDefinition): void => {
    if (route.pathParams) coercionPlanFor(route.pathParams);
    if (route.query) coercionPlanFor(route.query);
    if (route.headers) coercionPlanFor(route.headers);
};

const coerceValue = (value: unknown, type: string): unknown => {
    if (typeof value !== 'string') return value;
    if (type === 'number' || type === 'int') {
        const coerced = Number(value);
        return Number.isNaN(coerced) ? value : coerced;
    }
    if (type === 'boolean') {
        if (value === 'true') return true;
        if (value === 'false') return false;
        return value;
    }
    if (type === 'bigint') {
        try {
            return BigInt(value);
        } catch {
            // Invalid bigint; leave it for Zod to reject.
            return value;
        }
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date;
};

const coerceArray = (value: unknown, type: string): unknown => {
    if (!Array.isArray(value)) return value;
    let changed = false;
    const coerced = value.map((item) => {
        const next = coerceValue(item, type);
        if (next !== item) changed = true;
        return next;
    });
    return changed ? coerced : value;
};

/**
 * Applies a plan to one stage's raw input, returning the input itself when no
 * field changed.
 */
export const applyCoercion = (input: unknown, plan: CoercionPlan): unknown => {
    if (plan === null || !input || typeof input !== 'object' || Array.isArray(input)) return input;
    const record = input as Record<string, unknown>;
    let result: Record<string, unknown> | undefined;
    for (const field of plan) {
        const value = record[field.key];
        if (value === undefined) continue;
        const coerced = field.array ? coerceArray(value, field.type) : coerceValue(value, field.type);
        if (coerced === value) continue;
        result ??= { ...record };
        result[field.key] = coerced;
    }
    return result ?? input;
};
