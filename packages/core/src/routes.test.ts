import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { kizuna } from './kizuna.js';
import { createTags } from './tags.js';
import { ROUTES_TAG, type Routes } from './types.js';

const { k } = kizuna({
    tags: createTags({
        users: {
            title: 'Users',
            description: 'User management endpoints',
        },
    }),
});

describe('k.routes', () => {
    it('throws when a route has an empty body schema', () => {
        expect(() =>
            k.routes('users', {
                emptyAction: {
                    method: 'POST',
                    path: '/empty',
                    body: z.object({}),
                    responses: {
                        200: z.object({
                            ok: z.boolean(),
                        }),
                    },
                },
            })
        ).toThrowError('Route "emptyAction" has an empty body schema (z.object({})). Use z.void() or omit the body field.');
    });

    it('throws when a nested route has an empty body schema', () => {
        expect(() =>
            k.routes('users', {
                management: {
                    update: {
                        method: 'PUT',
                        path: '/users/:id',
                        body: z.object({}),
                        responses: {
                            200: z.object({
                                ok: z.boolean(),
                            }),
                        },
                    },
                },
            })
        ).toThrowError('has an empty body schema');
    });

    it('accepts a route with a non-empty body schema', () => {
        expect(() =>
            k.routes('users', {
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
            })
        ).not.toThrow();
    });

    it('accepts a route with z.void() body', () => {
        expect(() =>
            k.routes('users', {
                deleteUser: {
                    method: 'DELETE',
                    path: '/users/:id',
                    body: z.void(),
                    responses: {
                        204: z.void(),
                    },
                },
            })
        ).not.toThrow();
    });

    it('accepts a route with no body', () => {
        expect(() =>
            k.routes('users', {
                getUser: {
                    method: 'GET',
                    path: '/users/:id',
                    responses: {
                        200: z.object({
                            id: z.string(),
                        }),
                    },
                },
            })
        ).not.toThrow();
    });

    it('stamps ROUTES_TAG with the group tag', () => {
        const routes = k.routes('users', {
            getUser: {
                method: 'GET',
                path: '/users/:id',
                responses: {
                    200: z.object({
                        id: z.string(),
                    }),
                },
            },
        });
        expect((routes as Routes)[ROUTES_TAG]).toBe('users');
    });
});

describe('k.routes z.coerce ban', () => {
    it('throws when a top-level query schema is coerced', () => {
        expect(() =>
            k.routes('users', {
                listItems: {
                    method: 'GET',
                    path: '/items',
                    // eslint-disable-next-line @ts-kizuna/no-unsupported-schema -- intentional, asserts createContract throws on z.coerce
                    query: z.coerce.number(),
                    responses: {
                        200: z.object({
                            ok: z.boolean(),
                        }),
                    },
                },
            })
        ).toThrowError('Route "listItems" uses z.coerce at "query". z.coerce is not allowed in ts-kizuna contracts.');
    });

    it('throws and points at the nested field path that uses z.coerce', () => {
        expect(() =>
            k.routes('users', {
                listItems: {
                    method: 'GET',
                    path: '/items',
                    query: z.object({
                        // eslint-disable-next-line @ts-kizuna/no-unsupported-schema -- intentional, asserts createContract throws on z.coerce
                        page: z.coerce.number(),
                    }),
                    responses: {
                        200: z.object({
                            ok: z.boolean(),
                        }),
                    },
                },
            })
        ).toThrowError('Route "listItems" uses z.coerce at "query.page". z.coerce is not allowed in ts-kizuna contracts.');
    });

    it('finds z.coerce hidden inside arrays, wrappers, and unions', () => {
        expect(() =>
            k.routes('users', {
                createItem: {
                    method: 'POST',
                    path: '/items',
                    body: z.object({
                        // eslint-disable-next-line @ts-kizuna/no-unsupported-schema -- intentional, asserts createContract throws on z.coerce
                        prices: z.array(z.coerce.number()).optional(),
                    }),
                    responses: {
                        201: z.object({
                            ok: z.boolean(),
                        }),
                    },
                },
            })
        ).toThrowError('Route "createItem" uses z.coerce at "body.prices". z.coerce is not allowed in ts-kizuna contracts.');
    });

    it('rejects z.coerce in a response schema', () => {
        expect(() =>
            k.routes('users', {
                getItem: {
                    method: 'GET',
                    path: '/items/:id',
                    responses: {
                        200: z.object({
                            // eslint-disable-next-line @ts-kizuna/no-unsupported-schema -- intentional, asserts createContract throws on z.coerce
                            count: z.coerce.number(),
                        }),
                    },
                },
            })
        ).toThrowError('Route "getItem" uses z.coerce at "responses.200.count". z.coerce is not allowed in ts-kizuna contracts.');
    });

    it('accepts plain z.number()/z.date()/z.bigint() and z.any()/z.unknown()', () => {
        expect(() =>
            k.routes('users', {
                listItems: {
                    method: 'GET',
                    path: '/items',
                    query: z.object({
                        page: z.number(),
                        from: z.date(),
                        cursor: z.bigint(),
                        anything: z.any(),
                        whatever: z.unknown(),
                    }),
                    responses: {
                        200: z.object({
                            ok: z.boolean(),
                        }),
                    },
                },
            })
        ).not.toThrow();
    });
});
