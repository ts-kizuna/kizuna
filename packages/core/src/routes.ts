import type { z } from 'zod';
import { ROUTES_TAG, type Routes, type RouteDefinition, type ResponseDefinition } from './types.js';
import { isRouteDefinition } from './handler-pipeline.js';
import { type TagSet, type TagKeysOf, isTagSet } from './tags.js';
import { findCoercedSchemaPath } from './zod-internals.js';

const isEmptyObjectSchema = (schema: unknown): boolean => {
    if (!schema || typeof schema !== 'object') return false;
    const candidate = schema as Record<string, unknown>;
    return typeof candidate.shape === 'object' && candidate.shape !== null && Object.keys(candidate.shape as object).length === 0;
};

const isZodSchema = (value: unknown): value is z.core.$ZodType => typeof value === 'object' && value !== null && '_zod' in value;

const responseSchema = (response: ResponseDefinition): z.core.$ZodType | undefined => {
    if (isZodSchema(response)) return response;
    return response.body;
};

/**
 * Throws if any of a route's schemas use `z.coerce`. Built-in query/path/header
 * coercion makes it redundant.
 */
const assertNoCoercion = (route: RouteDefinition, routeKey: string): void => {
    const targets: Array<[string, z.core.$ZodType | undefined]> = [
        ['body', route.body],
        ['query', route.query],
        ['pathParams', route.pathParams],
        ['headers', route.headers],
    ];
    for (const [status, response] of Object.entries(route.responses)) {
        targets.push([`responses.${status}`, responseSchema(response)]);
    }
    for (const [field, schema] of targets) {
        if (!schema) continue;
        const coercedPath = findCoercedSchemaPath(schema);
        if (coercedPath === undefined) continue;
        const location = coercedPath ? `${field}.${coercedPath}` : field;
        throw new Error(
            `Route "${routeKey}" uses z.coerce at "${location}". z.coerce is not allowed in ts-kizuna contracts.\n` +
                `kizuna automatically coerces query, path, and header params to their declared types for you, ` +
                `so use z.number(), z.date(), or z.bigint() instead.`
        );
    }
};

const validateRoutes = (routes: Routes, prefix?: string): void => {
    for (const [key, value] of Object.entries(routes)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (isRouteDefinition(value)) {
            if (isEmptyObjectSchema(value.body)) {
                throw new Error(`Route "${fullKey}" has an empty body schema (z.object({})). Use z.void() or omit the body field.`);
            }
            assertNoCoercion(value, fullKey);
        } else if (value && typeof value === 'object') {
            validateRoutes(value as Routes, fullKey);
        }
    }
};

/**
 * Define a group of routes under a tag. Pass the tag set declared with
 * {@link createTags} for completion on the group tag and route-level `tags`; the
 * tag is stamped onto every route in the group.
 */
export function tagRoutes<const T extends Routes<TagKeysOf<Set>>, Set extends TagSet>(tags: Set, tag: TagKeysOf<Set>, routes: T): T;
export function tagRoutes<const T extends Routes<TagKeysOf<Set>>, Set extends TagSet>(tags: Set, routes: T): T;
export function tagRoutes<const T extends Routes>(tag: string, routes: T): T;
export function tagRoutes<const T extends Routes>(routes: T): T;
export function tagRoutes(first: TagSet | string | Routes, second?: string | Routes, third?: Routes): Routes {
    if (isTagSet(first)) {
        if (third !== undefined) {
            const result = third;
            (result as Record<typeof ROUTES_TAG, string>)[ROUTES_TAG] = second as string;
            validateRoutes(result);
            return result;
        }
        const result = second as Routes;
        validateRoutes(result);
        return result;
    }
    if (typeof first === 'string') {
        const result = second as Routes;
        (result as Record<typeof ROUTES_TAG, string>)[ROUTES_TAG] = first;
        validateRoutes(result);
        return result;
    }
    const result = first;
    validateRoutes(result);
    return result;
}
