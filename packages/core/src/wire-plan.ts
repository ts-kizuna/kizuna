import type { z } from 'zod';
import { resolveResponseBody } from './generator-utils.js';
import type { ResponseDefinition, RouteDefinition } from './types.js';
import { isUrlSchema, readDef, readDiscriminatedUnion, readDiscriminatorLiteral, readObjectShape, WRAPPER_TYPES } from './zod-internals.js';

/**
 * How a body reaches the wire. `json` bodies are already typed, so only the
 * values JSON cannot carry natively convert: `Date`, `bigint`, and `URL`.
 * `form` bodies (multipart and urlencoded) arrive as strings, so every
 * coercible scalar converts, the same set query params coerce.
 */
export type WireDialect = 'json' | 'form';

type WireLeafType = 'date' | 'bigint' | 'url' | 'number' | 'int' | 'boolean';

/**
 * One node of a wire plan: the conversions a body value needs between its
 * native form and the wire. `null` anywhere means that subtree passes through
 * untouched.
 */
export type WirePlanNode =
    | { kind: 'leaf'; type: WireLeafType }
    | { kind: 'object'; fields: Record<string, WirePlanNode> }
    | { kind: 'array'; element: WirePlanNode }
    | { kind: 'record'; value: WirePlanNode }
    | { kind: 'union'; discriminator: string; variants: Map<string | number, WirePlanNode> };

/**
 * The wire plan for a body schema, or `null` when nothing in it converts.
 */
export type WirePlan = WirePlanNode | null;

const JSON_LEAF_TYPES: ReadonlySet<string> = new Set(['date', 'bigint']);
const FORM_LEAF_TYPES: ReadonlySet<string> = new Set(['date', 'bigint', 'number', 'int', 'boolean']);

const buildWirePlan = (schema: z.core.$ZodType, dialect: WireDialect, io: 'input' | 'output'): WirePlan => {
    const def = readDef(schema);
    if (def.type && WRAPPER_TYPES.has(def.type) && def.innerType) {
        return buildWirePlan(def.innerType, dialect, io);
    }
    if (def.type === 'pipe') {
        const side = io === 'input' ? def.in : def.out;
        return side ? buildWirePlan(side, dialect, io) : null;
    }
    if (def.type === 'custom') {
        if (isUrlSchema(schema)) {
            return {
                kind: 'leaf',
                type: 'url',
            };
        }
        return null;
    }
    if (def.type !== undefined) {
        const leafTypes = dialect === 'json' ? JSON_LEAF_TYPES : FORM_LEAF_TYPES;
        if (leafTypes.has(def.type)) {
            return {
                kind: 'leaf',
                type: def.type as WireLeafType,
            };
        }
    }
    if (def.type === 'object') {
        const shape = readObjectShape(schema);
        if (!shape) return null;
        const fields: Record<string, WirePlanNode> = {};
        let any = false;
        for (const [key, field] of Object.entries(shape)) {
            const plan = buildWirePlan(field, dialect, io);
            if (plan !== null) {
                fields[key] = plan;
                any = true;
            }
        }
        return any
            ? {
                  kind: 'object',
                  fields,
              }
            : null;
    }
    if (def.type === 'array' && def.element) {
        const element = buildWirePlan(def.element, dialect, io);
        return element !== null
            ? {
                  kind: 'array',
                  element,
              }
            : null;
    }
    if (def.type === 'record' && def.valueType) {
        const value = buildWirePlan(def.valueType, dialect, io);
        return value !== null
            ? {
                  kind: 'record',
                  value,
              }
            : null;
    }
    if (def.type === 'union') {
        const union = readDiscriminatedUnion(schema);
        if (!union) return null;
        const variants = new Map<string | number, WirePlanNode>();
        for (const option of union.options) {
            const literal = readDiscriminatorLiteral(option, union.discriminator);
            if (literal === undefined) continue;
            const plan = buildWirePlan(option, dialect, io);
            if (plan !== null) variants.set(literal, plan);
        }
        return variants.size > 0
            ? {
                  kind: 'union',
                  discriminator: union.discriminator,
                  variants,
              }
            : null;
    }
    return null;
};

const planCaches = new Map<string, WeakMap<z.core.$ZodType, WirePlan>>();

/**
 * The wire plan for a body schema, built on first sight and cached afterwards.
 * `io` picks the side of a `pipe` the wire carries: `input` for request bodies,
 * `output` for response bodies.
 */
export const wirePlanFor = (schema: z.core.$ZodType, dialect: WireDialect, io: 'input' | 'output'): WirePlan => {
    const cacheKey = `${dialect}:${io}`;
    let cache = planCaches.get(cacheKey);
    if (!cache) {
        cache = new WeakMap();
        planCaches.set(cacheKey, cache);
    }
    if (cache.has(schema)) return cache.get(schema) ?? null;
    const plan = buildWirePlan(schema, dialect, io);
    cache.set(schema, plan);
    return plan;
};

const dialectForContentType = (contentType: string | undefined): WireDialect =>
    contentType === 'multipart/form-data' || contentType === 'application/x-www-form-urlencoded' ? 'form' : 'json';

/**
 * The wire plan for a route's request body, or `null` when the route has no
 * body or nothing in it converts.
 */
export const requestBodyPlanFor = (route: RouteDefinition): WirePlan =>
    route.body ? wirePlanFor(route.body, dialectForContentType(route.contentType), 'input') : null;

/**
 * The wire plan for one declared response body, or `null` when nothing in it
 * converts.
 */
export const responseBodyPlanFor = (response: ResponseDefinition): WirePlan => wirePlanFor(resolveResponseBody(response), 'json', 'output');

const hasRawJson =
    typeof (JSON as { rawJSON?: (source: string) => unknown }).rawJSON === 'function'
        ? (JSON as unknown as { rawJSON: (source: string) => unknown }).rawJSON
        : undefined;

const detectReviverContext = (): boolean => {
    let supported = false;
    JSON.parse('0', (_key: string, value: unknown, ...rest: unknown[]) => {
        supported = rest.length > 0;
        return value;
    });
    return supported;
};

const reviverContextSupported = detectReviverContext();

/**
 * The raw digits of a JSON integer that would lose precision as a `number`,
 * preserved by {@link parseJsonWithPlan} until the plan decides whether it is a
 * `bigint` field.
 */
class RawNumber {
    constructor(readonly source: string) {}
}

const INTEGER_SOURCE = /^-?\d+$/;

const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

const reviveLeaf = (value: unknown, type: WireLeafType): unknown => {
    if (type === 'bigint') {
        if (value instanceof RawNumber) return BigInt(value.source);
        if (typeof value === 'number' && Number.isInteger(value)) return BigInt(value);
        if (typeof value === 'string') {
            try {
                return BigInt(value);
            } catch {
                // Not bigint syntax; leave it for Zod to reject.
                return value;
            }
        }
        return value;
    }
    if (typeof value !== 'string') return value;
    if (type === 'date') {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? value : date;
    }
    if (type === 'url') {
        try {
            return new URL(value);
        } catch {
            // Not a URL; leave it for Zod to reject.
            return value;
        }
    }
    if (type === 'number' || type === 'int') {
        const coerced = Number(value);
        return Number.isNaN(coerced) ? value : coerced;
    }
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
};

const serializeLeaf = (value: unknown, type: WireLeafType, path: string): unknown => {
    if (type === 'date') {
        return value instanceof Date ? value.toISOString() : value;
    }
    if (type === 'url') {
        return value instanceof URL ? value.href : value;
    }
    if (type === 'bigint' && typeof value === 'bigint') {
        if (hasRawJson) return hasRawJson(value.toString());
        if (value >= MIN_SAFE_BIGINT && value <= MAX_SAFE_BIGINT) return Number(value);
        throw new Error(
            `Cannot serialize the bigint at "${path}": ${value} exceeds Number.MAX_SAFE_INTEGER and JSON.rawJSON is unavailable in this runtime.`
        );
    }
    return value;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
};

const applyPlan = (value: unknown, plan: WirePlanNode, direction: 'revive' | 'serialize', path: string): unknown => {
    if (value === undefined || value === null) return value;
    if (plan.kind === 'leaf') {
        return direction === 'revive' ? reviveLeaf(value, plan.type) : serializeLeaf(value, plan.type, path);
    }
    if (plan.kind === 'array') {
        if (!Array.isArray(value)) return value;
        let result: unknown[] | undefined;
        for (let index = 0; index < value.length; index += 1) {
            const item: unknown = value[index];
            const next = applyPlan(item, plan.element, direction, `${path}[${index}]`);
            if (next === item) continue;
            result ??= [...value];
            result[index] = next;
        }
        return result ?? value;
    }
    if (!isPlainObject(value)) return value;
    if (plan.kind === 'object') {
        let result: Record<string, unknown> | undefined;
        for (const [key, field] of Object.entries(plan.fields)) {
            const item = value[key];
            if (item === undefined) continue;
            const next = applyPlan(item, field, direction, path ? `${path}.${key}` : key);
            if (next === item) continue;
            result ??= { ...value };
            result[key] = next;
        }
        return result ?? value;
    }
    if (plan.kind === 'record') {
        let result: Record<string, unknown> | undefined;
        for (const [key, item] of Object.entries(value)) {
            const next = applyPlan(item, plan.value, direction, path ? `${path}.${key}` : key);
            if (next === item) continue;
            result ??= { ...value };
            result[key] = next;
        }
        return result ?? value;
    }
    const literal = value[plan.discriminator];
    if (typeof literal !== 'string' && typeof literal !== 'number') return value;
    const variant = plan.variants.get(literal);
    return variant ? applyPlan(value, variant, direction, path) : value;
};

/**
 * Converts a body's wire values to their native types (`Date`, `bigint`,
 * `URL`, and for form bodies every coercible scalar), returning the input
 * itself when nothing changed. Values that do not match the plan are left
 * untouched for Zod to report.
 */
export const reviveBody = (value: unknown, plan: WirePlan): unknown => (plan === null ? value : applyPlan(value, plan, 'revive', ''));

/**
 * Converts a body's native values to their wire form (`Date` to ISO 8601,
 * `URL` to its href, `bigint` to a JSON number), returning the input itself
 * when nothing changed. The result is for `JSON.stringify` only: bigint fields
 * become `JSON.rawJSON` carriers where the runtime supports them.
 */
export const serializeBody = (value: unknown, plan: WirePlan): unknown => (plan === null ? value : applyPlan(value, plan, 'serialize', ''));

const bigintPresence = new WeakMap<WirePlanNode, boolean>();

const planContainsBigint = (plan: WirePlanNode): boolean => {
    const cached = bigintPresence.get(plan);
    if (cached !== undefined) return cached;
    let contains = false;
    if (plan.kind === 'leaf') {
        contains = plan.type === 'bigint';
    } else if (plan.kind === 'array') {
        contains = planContainsBigint(plan.element);
    } else if (plan.kind === 'record') {
        contains = planContainsBigint(plan.value);
    } else if (plan.kind === 'object') {
        contains = Object.values(plan.fields).some((field) => planContainsBigint(field));
    } else {
        contains = Array.from(plan.variants.values()).some((variant) => planContainsBigint(variant));
    }
    bigintPresence.set(plan, contains);
    return contains;
};

const resolveStrayCarriers = (value: unknown): unknown => {
    if (value instanceof RawNumber) return Number(value.source);
    if (Array.isArray(value)) {
        let result: unknown[] | undefined;
        for (let index = 0; index < value.length; index += 1) {
            const item: unknown = value[index];
            const next = resolveStrayCarriers(item);
            if (next === item) continue;
            result ??= [...value];
            result[index] = next;
        }
        return result ?? value;
    }
    if (isPlainObject(value)) {
        let result: Record<string, unknown> | undefined;
        for (const [key, item] of Object.entries(value)) {
            const next = resolveStrayCarriers(item);
            if (next === item) continue;
            result ??= { ...value };
            result[key] = next;
        }
        return result ?? value;
    }
    return value;
};

/**
 * Parses a JSON body and revives it against a plan. When the plan declares a
 * bigint and the runtime's `JSON.parse` exposes the raw source, integers beyond
 * `Number.MAX_SAFE_INTEGER` reach bigint fields with their exact digits; any
 * that land outside a bigint field fall back to `number`.
 */
export const parseJsonWithPlan = (text: string, plan: WirePlan): unknown => {
    if (plan === null || !reviverContextSupported || !planContainsBigint(plan)) {
        return reviveBody(JSON.parse(text), plan);
    }
    let carriers = false;
    const parsed: unknown = JSON.parse(text, (_key: string, value: unknown, ...rest: unknown[]) => {
        const source = (rest[0] as { source?: string } | undefined)?.source;
        if (typeof value === 'number' && !Number.isSafeInteger(value) && typeof source === 'string' && INTEGER_SOURCE.test(source)) {
            carriers = true;
            return new RawNumber(source);
        }
        return value;
    });
    const revived = reviveBody(parsed, plan);
    return carriers ? resolveStrayCarriers(revived) : revived;
};
