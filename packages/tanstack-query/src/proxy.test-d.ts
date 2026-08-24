import { expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { Kizuna } from '@ts-kizuna/core';
import { KizunaClient } from '@ts-kizuna/fetch';
import { KizunaTanstackQuery } from './proxy.js';

const k = new Kizuna({
    groups: Kizuna.groups({
        users: 'Users',
    }),
});

const UserSchema = z.object({
    id: z.string(),
    name: z.string(),
});

const routes = k.routes.users({
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
            404: z.object({
                title: z.string(),
            }),
        },
    },
    searchUsers: {
        method: 'GET',
        path: '/users/search',
        query: z.object({
            term: z.string(),
            cursor: z.number().optional(),
        }),
        responses: {
            200: z.object({
                users: z.array(UserSchema),
                nextCursor: z.number().nullable(),
            }),
        },
    },
    createUser: {
        method: 'POST',
        path: '/users',
        body: z.object({
            name: z.string(),
        }),
        responses: {
            201: UserSchema,
        },
    },
});

const contract = k.contract({
    routes: {
        users: routes,
    },
});

const apiClient = new KizunaClient(contract, {
    baseUrl: 'http://localhost:8000',
});

const api = new KizunaTanstackQuery(contract, apiClient);

test('a route with a required query demands input', () => {
    // @ts-expect-error searchUsers declares a required `term`
    api.users.searchUsers.queryOptions({});
});

test('path params are typed', () => {
    // @ts-expect-error `id` is a string, not a number
    api.users.getUser.queryOptions({ input: { params: { id: 1 } } });
});

test('a mutation route has no query factories', () => {
    expectTypeOf(api.users.createUser).not.toHaveProperty('queryOptions');
    expectTypeOf(api.users.listUsers).not.toHaveProperty('mutationOptions');
});

test('groups and routes both expose a partial key', () => {
    expectTypeOf(api.users.key()).toEqualTypeOf<readonly [readonly string[]]>();
    expectTypeOf(api.users.getUser.key()).toEqualTypeOf<readonly [readonly string[]]>();
});
