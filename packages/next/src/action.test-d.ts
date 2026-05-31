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
    createUser: {
        method: 'POST',
        path: '/users',
        body: z.object({
            name: z.string(),
        }),
        responses: {
            201: z.object({
                id: z.string(),
                name: z.string(),
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

test('collapsed result is a discriminated union of success and typed errors', () => {
    const getUser = createServerAction(client.getUser);
    type Result = Awaited<ReturnType<typeof getUser>>;
    expectTypeOf<Result>().toEqualTypeOf<
        { ok: true; status: 200; data: { id: string; name: string } } | { ok: false; status: 404; error: { detail: string } }
    >();
});

test('a route with a body surfaces the validation error on failure', () => {
    const createUser = createServerAction(client.createUser);
    type Result = Awaited<ReturnType<typeof createUser>>;
    type Failure = Extract<Result, { ok: false }>;
    expectTypeOf<Failure['status']>().toEqualTypeOf<400>();
    expectTypeOf<Failure['error']>().toMatchTypeOf<{ errors: Array<{ path: string[]; message: string }> }>();
});

test('raw mode returns the response union', () => {
    const getUser = createServerAction(client.getUser, {
        raw: true,
    });
    type Result = Awaited<ReturnType<typeof getUser>>;
    expectTypeOf<Result>().toMatchTypeOf<{ status: number; body: unknown }>();
    expectTypeOf<Extract<Result, { status: 200 }>['body']>().toEqualTypeOf<{ id: string; name: string }>();
});

test('action requires the route input', () => {
    const createUser = createServerAction(client.createUser);
    expectTypeOf(createUser).parameter(0).toMatchTypeOf<{ body: { name: string } }>();
});

test('onError adds the thrown { status: 0 } case to the result', () => {
    const getUser = createServerAction(client.getUser, {
        onError: () => 'unreachable',
    });
    type Result = Awaited<ReturnType<typeof getUser>>;
    expectTypeOf<Extract<Result, { status: 0 }>>().toEqualTypeOf<{ ok: false; status: 0; error: string }>();
});

test('inject drops the injected field from the action input', () => {
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

test('inject rejects a key that is not a route argument', () => {
    createServerAction(client.createPost, {
        // @ts-expect-error - `bodssy` is not a field of the route arguments
        inject: async () => ({
            bodssy: {
                authorId: '',
            },
        }),
    });
});

test('inject rejects a wrong field type', () => {
    createServerAction(client.createPost, {
        // @ts-expect-error - authorId must be a string
        inject: async () => ({
            body: {
                authorId: 123,
            },
        }),
    });
});
