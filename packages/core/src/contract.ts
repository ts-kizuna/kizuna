import { CONTRACT_TAG, type Contract } from './types.js';
import { isRouteDefinition } from './handler-pipeline.js';

const isEmptyObjectSchema = (schema: unknown): boolean => {
    if (!schema || typeof schema !== 'object') return false;
    const candidate = schema as Record<string, unknown>;
    return typeof candidate.shape === 'object' && candidate.shape !== null && Object.keys(candidate.shape as object).length === 0;
};

const validateContract = (contract: Contract, prefix?: string): void => {
    for (const [key, value] of Object.entries(contract)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (isRouteDefinition(value)) {
            if (isEmptyObjectSchema(value.body)) {
                throw new Error(`Route "${fullKey}" has an empty body schema (z.object({})). Use z.void() or omit the body field.`);
            }
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
 * // users.contract.ts
 * export const usersContract = createContract('users', {
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
export const createContract = <const T extends Contract>(tagOrRoutes: string | T, routes?: T): T => {
    const tag = typeof tagOrRoutes === 'string' ? tagOrRoutes : undefined;
    const result = (typeof tagOrRoutes === 'string' ? routes! : tagOrRoutes) as T;
    if (tag !== undefined) {
        (result as Record<typeof CONTRACT_TAG, string>)[CONTRACT_TAG] = tag;
    }
    validateContract(result);
    return result;
};
