import { test } from 'vitest';
import { z } from 'zod';
import { kizuna, createTags } from '@ts-kizuna/core';
import { createServer } from './server.js';

const { k } = kizuna({
    tags: createTags({
        api: 'API',
    }),
});

const userRoutes = k.routes('api', {
    getUser: {
        method: 'GET',
        path: '/users/:id',
        responses: {
            200: z.object({
                id: z.string(),
                name: z.string(),
            }),
        },
    },
});

const contract = k.contract({
    routes: {
        users: userRoutes,
    },
});

test('server.router types a group by name when its handlers take no arguments', () => {
    const { server } = createServer(contract);

    const users = server.router('users', {
        getUser: async () => ({
            status: 200,
            body: {
                id: '1',
                name: 'x',
            },
        }),
    });

    server.api({
        router: {
            users,
        },
    });
});

test('server.router contextually types a bare route group', () => {
    const { server } = createServer(contract);

    server.router(userRoutes, {
        getUser: async () => ({
            status: 200,
            body: {
                id: '1',
                name: 'x',
            },
        }),
    });
});
