import { Kizuna } from '@ts-kizuna/core';
import { ProblemDetailsSchema } from '@ts-kizuna/core/schemas';
import { z } from 'zod';

export const UserSchema = z.object({
    id: z.string(),
    name: z.string(),
    email: z.email(),
});

const k = new Kizuna({});

const benchRoutes = k.routes('bench', {
    getUser: {
        method: 'GET',
        path: '/users/:id',
        responses: {
            200: UserSchema,
            404: ProblemDetailsSchema,
        },
    },
    listUsers: {
        method: 'GET',
        path: '/users',
        query: z.object({
            page: z.number().int().min(1).default(1),
            limit: z.number().int().min(1).max(100).default(10),
        }),
        responses: {
            200: z.object({
                users: z.array(UserSchema),
                total: z.number(),
            }),
        },
    },
    createUser: {
        method: 'POST',
        path: '/users',
        body: z.object({
            name: z.string().min(1),
            email: z.email(),
        }),
        responses: {
            201: UserSchema,
            400: ProblemDetailsSchema,
        },
    },
});

export const contract = k.contract({
    routes: {
        bench: benchRoutes,
    },
});
