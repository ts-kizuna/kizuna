import { expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { createContract } from '@ts-kizuna/core';
import { createClient } from '@ts-kizuna/fetch';
import { createServerAction } from './action.js';

const contract = createContract({
    getUser: {
        method: 'GET',
        path: '/users/:id',
        responses: {
            200: z.object({
                id: z.string(),
                name: z.string(),
            }),
            404: z.object({
                detail: z.string(),
            }),
        },
    },
    createPost: {
        method: 'POST',
        path: '/posts',
        body: z.object({
            title: z.string(),
            authorId: z.string(),
        }),
        responses: {
            201: z.object({
                id: z.string(),
            }),
        },
    },
});

const client = createClient(contract, {
    baseUrl: '',
});

test('the action returns the client response union — narrow on status', () => {
    const getUser = createServerAction(client.getUser);
    type Result = Awaited<ReturnType<typeof getUser>>;
    expectTypeOf<Result>().toEqualTypeOf<
        | { status: 200; body: { id: string; name: string }; headers: Record<string, string> }
        | { status: 404; body: { detail: string }; headers: Record<string, string> }
    >();
});

test('inject strips the injected field from the action input', () => {
    const createPost = createServerAction(client.createPost, {
        inject: async () => ({
            body: {
                authorId: '',
            },
        }),
    });
    type Body = Parameters<typeof createPost>[0]['body'];
    expectTypeOf<Body>().toEqualTypeOf<{ title: string }>();
});

test('the action input drops the client-only fetchOptions', () => {
    const createPost = createServerAction(client.createPost);
    type Input = Parameters<typeof createPost>[0];
    expectTypeOf<'fetchOptions' extends keyof Input ? true : false>().toEqualTypeOf<false>();
});

test('inject rejects a key that is not a route argument', () => {
    // @ts-expect-error - `bodssy` is not a field of the route arguments
    createServerAction(client.createPost, {
        inject: async () => ({
            bodssy: {
                authorId: '',
            },
        }),
    });
});

test('inject rejects a wrong field type', () => {
    // @ts-expect-error - authorId must be a string
    createServerAction(client.createPost, {
        inject: async () => ({
            body: {
                authorId: 123,
            },
        }),
    });
});
