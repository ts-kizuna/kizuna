import { z } from 'zod';
import { createContract } from './contract.js';
import { createTag } from './tag.js';
import { createApi } from './adapter.js';
import { createClient } from '../../fetch/src/client.js';

const Paginated = <T extends z.ZodType>(itemSchema: T) =>
    z.object({
        items: z.array(itemSchema),
        total: z.number(),
    });

const UserSchema = z.object({
    id: z.string(),
    /**
     * @deprecated
     */
    email: z.string(),
});

const NamedUserSchema = z
    .object({
        id: z.string(),
        /**
         * @deprecated
         */
        email: z.string(),
    })
    .meta({
        id: 'User',
    });

const ExtendedUserSchema = UserSchema.extend({
    fullName: z.string(),
});

// Sub-contract defined with a tag *before* the main export — this used to confuse the
// deprecation walker into treating the tag string as the routes argument and returning an
// empty map.
const Health = createTag({
    title: 'Health',
});

const Users = createTag({
    title: 'Users',
});

const healthContract = createContract(Health, {
    check: {
        method: 'GET' as const,
        path: '/health',
        responses: {
            200: z.object({
                ok: z.boolean(),
            }),
        },
    },
});

const usersContract = createContract(Users, {
    listUsers: {
        method: 'GET' as const,
        path: '/users',
        responses: {
            200: z.object({
                users: z.array(UserSchema),
            }),
        },
    },
    getUser: {
        method: 'GET' as const,
        path: '/users/:id',
        responses: {
            200: UserSchema,
        },
    },
    /**
     * @deprecated
     */
    deleteUser: {
        method: 'DELETE' as const,
        path: '/users/:id',
        responses: {
            200: z.object({
                success: z.boolean(),
            }),
        },
    },
});

export const contract = createContract({
    health: healthContract,
    /**
     * @deprecated use newRoute instead
     */
    oldRoute: {
        method: 'GET',
        path: '/old',
        responses: {
            200: z.object({
                ok: z.boolean(),
            }),
        },
    },
    newRoute: {
        method: 'POST',
        path: '/new',
        body: z.object({
            /**
             * @deprecated
             */
            name: z.string(),
            fullName: z.string(),
        }),
        query: z.object({
            /**
             * @deprecated
             */
            page: z.number().optional(),
            cursor: z.string().optional(),
        }),
        responses: {
            200: z.object({
                ok: z.boolean(),
            }),
        },
    },
    listUsers: {
        method: 'GET',
        path: '/users',
        responses: {
            200: z.object({
                users: z.array(UserSchema),
            }),
        },
    },
    getUser: {
        method: 'GET',
        path: '/users/:id',
        responses: {
            200: UserSchema,
        },
    },
    getExtendedUser: {
        method: 'GET',
        path: '/users/extended/:id',
        responses: {
            200: ExtendedUserSchema,
        },
    },
    listUsersPaginated: {
        method: 'GET',
        path: '/users/paginated',
        responses: {
            200: Paginated(UserSchema),
        },
    },
    getUserByIdV2: {
        method: 'GET',
        path: '/users/v2/:id',
        responses: {
            200: z.object({
                id: z.string(),
                /**
                 * @deprecated use email_address instead
                 */
                email: z.string(),
            }),
        },
    },
    /**
     * @deprecated
     */
    getUserById: {
        method: 'GET',
        path: '/users/by-id/:id',
        tags: [Users],
        security: [
            {
                bearerAuth: [],
            },
        ],
        externalDocs: {
            url: 'https://example.com/docs/getUser',
            description: 'Reference docs',
        },
        responses: {
            200: NamedUserSchema,
        },
    },
});

export const api = createApi({
    users: usersContract,
    health: healthContract,
});

export const client = createClient(contract, {
    baseUrl: 'http://localhost:3000',
});
