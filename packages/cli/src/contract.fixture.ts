import { z } from 'zod';
import { Kizuna } from '@ts-kizuna/core';
import { KizunaClient } from '../../fetch/src/client.js';

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

const NamedUserSchema = Kizuna.model({
    title: 'User',
    schema: z.object({
        id: z.string(),
        /**
         * @deprecated
         */
        email: z.string(),
    }),
});

const ExtendedUserSchema = UserSchema.extend({
    fullName: z.string(),
});

export const tags = Kizuna.tags({
    api: {
        title: 'API',
    },
    health: {
        title: 'Health',
    },
    users: {
        title: 'Users',
    },
});

const k = new Kizuna({ tags });

const healthRoutes = k.routes('health', {
    check: {
        method: 'GET',
        path: '/health',
        responses: {
            200: z.object({
                ok: z.boolean(),
            }),
        },
    },
});

const usersRoutes = k.routes('users', {
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
    /**
     * @deprecated
     */
    deleteUser: {
        method: 'DELETE',
        path: '/users/:id',
        responses: {
            200: z.object({
                success: z.boolean(),
            }),
        },
    },
});

const routes = k.routes('api', {
    health: healthRoutes,
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
    /**
     * @description Creates a user from the submitted name.
     * @example
     * {
     *     fullName: 'Ada Lovelace',
     * }
     */
    newRoute: {
        method: 'POST',
        path: '/new',
        body: z.object({
            /**
             * @description The display name.
             * @deprecated use fullName instead
             */
            name: z.string(),
            /**
             * @example Ada Lovelace
             */
            fullName: z.string(),
        }),
        query: z.object({
            /**
             * @deprecated
             */
            page: z.number().optional(),
            /**
             * @example eyJpZCI6IjQyIn0
             * @example eyJpZCI6Ijk5In0
             */
            cursor: z.string().optional(),
        }),
        responses: {
            /**
             * @description The user was created.
             */
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
    /**
     * @summary List users, one page at a time.
     * @description Pages are cursor-based, so a page boundary is stable while
     * users are being created.
     */
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
        pathParams: z.object({
            /**
             * @description The user id, as returned by listUsers.
             */
            id: z.string(),
        }),
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
        tags: ['users'],
        externalDocs: {
            url: 'https://example.com/docs/getUser',
            description: 'Reference docs',
        },
        responses: {
            200: NamedUserSchema,
        },
    },
});

export const contract = k.contract({ routes });

export const api = k.contract({
    routes: {
        users: usersRoutes,
        health: healthRoutes,
    },
});

export const client = new KizunaClient(contract, {
    baseUrl: 'http://localhost:3000',
});
