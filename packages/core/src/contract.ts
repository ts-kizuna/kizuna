import type { z } from 'zod';
import { CONTRACT_TAG, CONTRACT_DESCRIPTION, type Contract, type RouteDefinition, type ResponseDefinition } from './types.js';
import { isRouteDefinition } from './handler-pipeline.js';
import { type Tag, isTag } from './tag.js';
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

const validateContract = (contract: Contract, prefix?: string): void => {
    for (const [key, value] of Object.entries(contract)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (isRouteDefinition(value)) {
            if (isEmptyObjectSchema(value.body)) {
                throw new Error(`Route "${fullKey}" has an empty body schema (z.object({})). Use z.void() or omit the body field.`);
            }
            assertNoCoercion(value, fullKey);
        } else if (value && typeof value === 'object') {
            validateContract(value as Contract, fullKey);
        }
    }
};

/**
 * Define the contract shared between your server and client.
 *
 * **Single file**
 * ```ts
 * export const contract = createContract({
 *     createUser: {
 *         method: 'POST',
 *         path: '/users',
 *         body: CreateUserSchema,
 *         responses: {
 *             201: UserSchema,
 *         },
 *     },
 *     health: {
 *         check: {
 *             method: 'GET',
 *             path: '/health',
 *             responses: {
 *                 200: z.object({
 *                     ok: z.boolean(),
 *                 }),
 *             },
 *         },
 *     },
 * });
 * ```
 *
 * **Split across files**
 *
 * ```ts
 * // tags.ts
 * const Users = createTag({
 *     title: 'Users',
 *     description: 'User management endpoints',
 * });
 *
 * // users.contract.ts
 * export const usersContract = createContract(Users, {
 *     createUser: {
 *         method: 'POST',
 *         path: '/users',
 *         body: CreateUserSchema,
 *         responses: {
 *             201: UserSchema,
 *         },
 *     },
 * });
 *
 * // contract.ts
 * import { usersContract } from './users.contract';
 * import { healthContract } from './health.contract';
 *
 * export const contract = createContract({
 *     users: usersContract,
 *     health: healthContract,
 * });
 * ```
 */
export function createContract<const T extends Contract>(tag: Tag, routes: T): T;
export function createContract<const T extends Contract>(routes: T): T;
export function createContract(tagOrRoutes: Tag | Contract, routes?: Contract): Contract {
    if (isTag(tagOrRoutes)) {
        const result = routes!;
        (result as Record<typeof CONTRACT_TAG, string>)[CONTRACT_TAG] = tagOrRoutes.title;
        if (tagOrRoutes.description !== undefined) {
            (result as Record<typeof CONTRACT_DESCRIPTION, string>)[CONTRACT_DESCRIPTION] = tagOrRoutes.description;
        }
        validateContract(result);
        return result;
    }
    const result = tagOrRoutes as Contract;
    validateContract(result);
    return result;
}
