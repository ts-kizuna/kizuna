import { z } from 'zod';
import { Kizuna } from '@ts-kizuna/shared';
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
