import { expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { createContract, type ValidationError } from '@ts-kizuna/core';
import { createClient } from './client.js';

const contract = createContract({
    getUser: {
        method: 'GET',
        path: '/users/:id',
        responses: {
            200: {
                body: z.object({
                    id: z.string(),
                    name: z.string(),
                }),
                headers: z.object({
                    'x-request-id': z.string().optional(),
                }),
            },
            404: z.object({
                message: z.string(),
            }),
        },
    },
    createUser: {
        method: 'POST',
        path: '/users',
        body: z.object({
            name: z.string(),
            email: z.string(),
        }),
        responses: {
            201: z.object({
                id: z.string(),
                name: z.string(),
                email: z.string(),
            }),
        },
    },
    listUsers: {
        method: 'GET',
        path: '/users',
        query: z.object({
            page: z.number().optional(),
        }),
        responses: {
            200: z.object({
                users: z.array(z.string()),
            }),
        },
    },
    typedQuery: {
        method: 'GET',
        path: '/typed',
        query: z.object({
            page: z.number().int().min(1).default(1),
            from: z.date(),
            cursor: z.bigint(),
            search: z.string(),
            transformed: z.string().transform((value) => value.length),
        }),
        responses: {
            200: z.object({
                ok: z.boolean(),
            }),
        },
    },
    nestedTyped: {
        method: 'POST',
        path: '/nested',
        body: z.object({
            filters: z.object({
                price: z.number(),
                createdAt: z.date(),
                tags: z.array(
                    z.object({
                        weight: z.number(),
                        name: z.string(),
                    })
                ),
            }),
            scores: z.array(z.number()),
            pair: z.tuple([z.number(), z.string()]),
        }),
        responses: {
            200: z.object({
                ok: z.boolean(),
            }),
        },
    },
    discriminatedTyped: {
        method: 'POST',
        path: '/discriminated',
        body: z.discriminatedUnion('kind', [
            z.object({
                kind: z.literal('count'),
                count: z.number(),
            }),
            z.object({
                kind: z.literal('name'),
                name: z.string(),
            }),
        ]),
        responses: {
            200: z.object({
                ok: z.boolean(),
            }),
        },
    },
    arrayOfDiscriminatedTyped: {
        method: 'POST',
        path: '/array-of-discriminated',
        body: z.object({
            events: z.array(
                z.discriminatedUnion('kind', [
                    z.object({
                        kind: z.literal('view'),
                        viewedAt: z.number(),
                    }),
                    z.object({
                        kind: z.literal('purchase'),
                        amount: z.number(),
                        currency: z.string(),
                    }),
                ])
            ),
        }),
        responses: {
            200: z.object({
                ok: z.boolean(),
            }),
        },
    },
    nestedDiscriminatedTyped: {
        method: 'POST',
        path: '/nested-discriminated',
        body: z.object({
            wrapper: z.object({
                strategy: z.discriminatedUnion('kind', [
                    z.object({
                        kind: z.literal('linear'),
                        slope: z.number(),
                    }),
                    z.object({
                        kind: z.literal('exponential'),
                        base: z.number(),
                    }),
                ]),
            }),
        }),
        responses: {
            200: z.object({
                ok: z.boolean(),
            }),
        },
    },
});

const voidBodyContract = createContract({
    deleteItem: {
        method: 'DELETE',
        path: '/items/:id',
        body: z.void(),
        responses: {
            200: z.object({
                success: z.boolean(),
            }),
        },
    },
});

const voidBodyClient = createClient(voidBodyContract, {
    baseUrl: 'http://localhost:3000',
});

test('route with body: z.void() does not require a body argument', async () => {
    await voidBodyClient.deleteItem({
        params: { id: '1' },
    });
});

test('route with body: z.void() rejects a non-void body', () => {
    // @ts-expect-error body should not accept an object
    voidBodyClient.deleteItem({ params: { id: '1' }, body: { foo: 'bar' } });
});

const nestedContract = createContract({
    users: createContract({
        getUser: {
            method: 'GET',
            path: '/users/:id',
            responses: {
                200: z.object({
                    id: z.string(),
                    name: z.string(),
                }),
                404: z.object({
                    message: z.string(),
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
                }),
            },
        },
    }),
    posts: createContract({
        listPosts: {
            method: 'GET',
            path: '/posts',
            responses: {
                200: z.object({
                    posts: z.array(z.string()),
                }),
            },
        },
    }),
});

const nestedClient = createClient(nestedContract, {
    baseUrl: 'http://localhost:3000',
});

const client = createClient(contract, {
    baseUrl: 'http://localhost:3000',
});

test('client exposes one function per route', () => {
    expectTypeOf(client).toHaveProperty('getUser');
    expectTypeOf(client).toHaveProperty('createUser');
    expectTypeOf(client).toHaveProperty('listUsers');
});

test('getUser requires params with the right shape', async () => {
    const result = await client.getUser({
        params: {
            id: '1',
        },
    });
    if (result.status === 200) {
        expectTypeOf(result.body).toEqualTypeOf<{ id: string; name: string }>();
        expectTypeOf(result.headers).toEqualTypeOf<{ 'x-request-id'?: string | undefined }>();
    } else if (result.status === 404) {
        expectTypeOf(result.body).toEqualTypeOf<{ message: string }>();
        expectTypeOf(result.headers).toEqualTypeOf<Record<string, string>>();
    }
});

test('createUser requires body with the right shape', async () => {
    const result = await client.createUser({
        body: {
            name: 'Alice',
            email: 'alice@test.com',
        },
    });
    if (result.status === 201) {
        expectTypeOf(result.body).toEqualTypeOf<{ id: string; name: string; email: string }>();
    }
});

test('listUsers can be called without args when all query fields are optional', async () => {
    const result = await client.listUsers();
    if (result.status === 200) {
        expectTypeOf(result.body).toEqualTypeOf<{ users: string[] }>();
    }
});

test('listUsers also accepts explicit query', async () => {
    const result = await client.listUsers({ query: { page: 1 } });
    if (result.status === 200) {
        expectTypeOf(result.body).toEqualTypeOf<{ users: string[] }>();
    }
});

test('rejects wrong param shape', () => {
    // @ts-expect-error wrong param key
    client.getUser({ params: { userId: '1' } });
});

test('rejects wrong body shape', () => {
    // @ts-expect-error missing email
    client.createUser({ body: { name: 'Alice' } });
});

test('rejects extra body field', () => {
    // @ts-expect-error extra `extra` key
    client.createUser({ body: { name: 'A', email: 'a@b.com', extra: true } });
});

test('rejects body on a route that does not accept one', () => {
    // @ts-expect-error getUser has no body schema
    client.getUser({ params: { id: '1' }, body: { foo: 'bar' } });
});

test('plain and transform query fields surface as their input types', async () => {
    await client.typedQuery({
        query: {
            search: 'hello',
            transformed: 'world',
            page: 1,
            from: new Date(),
            cursor: 1n,
        },
    });
    type Query = Parameters<typeof client.typedQuery>[0]['query'];
    expectTypeOf<Query['page']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Query['from']>().toEqualTypeOf<Date>();
    expectTypeOf<Query['cursor']>().toEqualTypeOf<bigint>();
    expectTypeOf<Query['search']>().toEqualTypeOf<string>();
    expectTypeOf<Query['transformed']>().toEqualTypeOf<string>();
});

test('nested object, array, and date/bigint fields surface as their input types', async () => {
    await client.nestedTyped({
        body: {
            filters: {
                price: 99,
                createdAt: new Date(),
                tags: [
                    {
                        weight: 1,
                        name: 'a',
                    },
                ],
            },
            scores: [1, 2, 3],
            pair: [1, 'two'],
        },
    });
    type Body = Parameters<typeof client.nestedTyped>[0]['body'];
    expectTypeOf<Body['filters']['price']>().toEqualTypeOf<number>();
    expectTypeOf<Body['filters']['createdAt']>().toEqualTypeOf<Date>();
    expectTypeOf<Body['filters']['tags'][number]['weight']>().toEqualTypeOf<number>();
    expectTypeOf<Body['filters']['tags'][number]['name']>().toEqualTypeOf<string>();
    expectTypeOf<Body['scores']>().toEqualTypeOf<number[]>();
    expectTypeOf<Body['pair']>().toEqualTypeOf<[number, string]>();
});

test('nested number field rejects wrong-typed values', () => {
    client.nestedTyped({
        body: {
            filters: {
                // @ts-expect-error price must be a number
                price: '99',
                createdAt: new Date(),
                tags: [],
            },
            scores: [],
            pair: [1, 'x'],
        },
    });
});

test('number inside a discriminated union inside an array resolves per branch per element', async () => {
    await client.arrayOfDiscriminatedTyped({
        body: {
            events: [
                {
                    kind: 'view',
                    viewedAt: 1700000000000,
                },
                {
                    kind: 'purchase',
                    amount: 99,
                    currency: 'USD',
                },
            ],
        },
    });
    type Body = Parameters<typeof client.arrayOfDiscriminatedTyped>[0]['body'];
    type Event = Body['events'][number];
    type ViewEvent = Extract<Event, { kind: 'view' }>;
    type PurchaseEvent = Extract<Event, { kind: 'purchase' }>;
    expectTypeOf<ViewEvent['viewedAt']>().toEqualTypeOf<number>();
    expectTypeOf<PurchaseEvent['amount']>().toEqualTypeOf<number>();
    expectTypeOf<PurchaseEvent['currency']>().toEqualTypeOf<string>();
});

test('number inside a discriminated union inside an array rejects wrong-typed branch values', () => {
    client.arrayOfDiscriminatedTyped({
        body: {
            events: [
                {
                    kind: 'purchase',
                    // @ts-expect-error amount must be a number
                    amount: '99',
                    currency: 'USD',
                },
            ],
        },
    });
});

test('number inside a discriminated union nested in an object resolves per branch', async () => {
    await client.nestedDiscriminatedTyped({
        body: {
            wrapper: {
                strategy: {
                    kind: 'linear',
                    slope: 0.5,
                },
            },
        },
    });
    type Body = Parameters<typeof client.nestedDiscriminatedTyped>[0]['body'];
    type Strategy = Body['wrapper']['strategy'];
    type LinearBranch = Extract<Strategy, { kind: 'linear' }>;
    type ExponentialBranch = Extract<Strategy, { kind: 'exponential' }>;
    expectTypeOf<LinearBranch['slope']>().toEqualTypeOf<number>();
    expectTypeOf<ExponentialBranch['base']>().toEqualTypeOf<number>();
});

test('number inside a discriminated union resolves per branch', async () => {
    await client.discriminatedTyped({
        body: {
            kind: 'count',
            count: 7,
        },
    });
    await client.discriminatedTyped({
        body: {
            kind: 'name',
            name: 'alice',
        },
    });
    type Body = Parameters<typeof client.discriminatedTyped>[0]['body'];
    type CountBranch = Extract<Body, { kind: 'count' }>;
    type NameBranch = Extract<Body, { kind: 'name' }>;
    expectTypeOf<CountBranch['count']>().toEqualTypeOf<number>();
    expectTypeOf<NameBranch['name']>().toEqualTypeOf<string>();
});

test('number query field rejects values of the wrong type', () => {
    client.typedQuery({
        query: {
            search: 'hello',
            transformed: 'world',
            from: new Date(),
            cursor: 1n,
            // @ts-expect-error page must be a number, not a string
            page: '1',
        },
    });
});

test('nested client exposes sub-router namespaces', () => {
    expectTypeOf(nestedClient).toHaveProperty('users');
    expectTypeOf(nestedClient).toHaveProperty('posts');
});

test('nested client sub-router exposes its own route functions', () => {
    expectTypeOf(nestedClient.users).toHaveProperty('getUser');
    expectTypeOf(nestedClient.users).toHaveProperty('createUser');
    expectTypeOf(nestedClient.posts).toHaveProperty('listPosts');
});

test('nested route response type narrows correctly by status', async () => {
    const result = await nestedClient.users.getUser({
        params: {
            id: '1',
        },
    });
    if (result.status === 200) {
        expectTypeOf(result.body).toEqualTypeOf<{ id: string; name: string }>();
    } else if (result.status === 404) {
        expectTypeOf(result.body).toEqualTypeOf<{ message: string }>();
    }
});

test('nested route body arg has the correct shape', async () => {
    const result = await nestedClient.users.createUser({
        body: {
            name: 'Alice',
        },
    });
    if (result.status === 201) {
        expectTypeOf(result.body).toEqualTypeOf<{ id: string }>();
    }
});

test('nested route rejects wrong param key', () => {
    // @ts-expect-error wrong param key
    nestedClient.users.getUser({ params: { userId: '1' } });
});

test('nested route rejects body on a route that has none', () => {
    // @ts-expect-error listPosts has no body schema
    nestedClient.posts.listPosts({ body: { foo: 'bar' } });
});

test('route with body includes ValidationError as a possible 400 response', async () => {
    const result = await client.createUser({
        body: { name: 'Alice', email: 'alice@test.com' },
    });
    if (result.status === 400) {
        expectTypeOf(result.body).toEqualTypeOf<ValidationError>();
    }
});

test('route with query includes ValidationError as a possible 400 response', async () => {
    const result = await client.listUsers();
    if (result.status === 400) {
        expectTypeOf(result.body).toEqualTypeOf<ValidationError>();
    }
});

test('route without body or query does not include ValidationError', async () => {
    const result = await client.getUser({ params: { id: '1' } });
    // getUser has no body/query, so 400 is not a possible status
    // (it only has 200 and 404)
    expectTypeOf(result.status).toEqualTypeOf<200 | 404>();
});

const UserIdSchema = z.string().brand<'UserId'>();

const pathParamsContract = createContract({
    getUserEvents: {
        method: 'GET',
        path: '/users/:userId/events/:eventId',
        pathParams: z.object({
            userId: UserIdSchema,
            eventId: z.string(),
        }),
        responses: {
            200: z.object({
                ok: z.boolean(),
            }),
        },
    },
    listEventsByYear: {
        method: 'GET',
        path: '/events/:year',
        pathParams: z.object({
            year: z.coerce.number(),
        }),
        responses: {
            200: z.object({
                ok: z.boolean(),
            }),
        },
    },
});

const pathParamsClient = createClient(pathParamsContract, {
    baseUrl: 'http://localhost:3000',
});

test('pathParams schema types client params by its output type', async () => {
    const userId = UserIdSchema.parse('user-1');
    await pathParamsClient.getUserEvents({
        params: {
            userId,
            eventId: 'event-1',
        },
    });
    expectTypeOf<Parameters<typeof pathParamsClient.getUserEvents>[0]['params']>().toEqualTypeOf<{
        userId: z.output<typeof UserIdSchema>;
        eventId: string;
    }>();
});

test('pathParams schema rejects a plain string for a branded param', () => {
    // @ts-expect-error plain string is not a UserId
    pathParamsClient.getUserEvents({ params: { userId: 'user-1', eventId: 'event-1' } });
});

test('coerced pathParams surface as their output type on the client', async () => {
    await pathParamsClient.listEventsByYear({
        params: {
            year: 2026,
        },
    });
});

test('coerced pathParams reject values the output type does not accept', () => {
    // @ts-expect-error year must be a number
    pathParamsClient.listEventsByYear({ params: { year: '2026' } });
});

test('routes without a pathParams schema keep template-derived params', () => {
    expectTypeOf<Parameters<typeof client.getUser>[0]['params']>().toEqualTypeOf<{ id: string }>();
});
