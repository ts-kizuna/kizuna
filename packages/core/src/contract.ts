import { CONTRACT_TAG, type Contract } from './types.js';

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
    return result;
};
