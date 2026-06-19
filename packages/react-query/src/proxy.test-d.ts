import { expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { createContract } from '@ts-kizuna/core';
import type { Client } from '@ts-kizuna/fetch';
import { createKizunaProxy } from './proxy.js';
import type { KizunaPathKey, KizunaQueryKey } from './types.js';

const contract = createContract({
    getUser: {
        method: 'GET',
        path: '/users/:id',
        responses: {
            200: z.object({ id: z.string() }),
            404: z.object({ error: z.string() }),
        },
    },
    createUser: {
        method: 'POST',
        path: '/users',
        body: z.object({ name: z.string() }),
        responses: {
            201: z.object({ id: z.string() }),
        },
    },
    health: createContract({
        check: {
            method: 'GET',
            path: '/health',
            responses: {
                200: z.object({ ok: z.boolean() }),
            },
        },
    }),
});

const client = {} as Client<typeof contract>;
const api = createKizunaProxy({ client });

test('query operations expose query factories, not mutation factories', () => {
    expectTypeOf(api.getUser).toHaveProperty('queryOptions');
    expectTypeOf(api.getUser).toHaveProperty('queryKey');
    expectTypeOf(api.getUser).toHaveProperty('queryFilter');
    expectTypeOf(api.getUser).not.toHaveProperty('mutationOptions');
});

test('mutation operations expose mutation factories, not query factories', () => {
    expectTypeOf(api.createUser).toHaveProperty('mutationOptions');
    expectTypeOf(api.createUser).toHaveProperty('mutationKey');
    expectTypeOf(api.createUser).not.toHaveProperty('queryOptions');
});

test('queryOptions requires input when the operation takes path params', () => {
    api.getUser.queryOptions({ params: { id: '1' } });
    // @ts-expect-error params is required for /users/:id
    api.getUser.queryOptions({});
    // @ts-expect-error input is required
    api.getUser.queryOptions();
});

test('queryOptions input is optional when the operation takes no args', () => {
    api.health.check.queryOptions();
    api.health.check.queryOptions(undefined, { staleTime: 1000 });
});

test('queryKey returns the typed kizuna query key', () => {
    expectTypeOf(api.getUser.queryKey({ params: { id: '1' } })).toEqualTypeOf<KizunaQueryKey>();
});

test('router nodes carry path-level factories', () => {
    expectTypeOf(api.health.pathKey()).toEqualTypeOf<KizunaPathKey>();
    expectTypeOf(api.pathKey()).toEqualTypeOf<KizunaPathKey>();
    expectTypeOf(api.health).toHaveProperty('check');
});
