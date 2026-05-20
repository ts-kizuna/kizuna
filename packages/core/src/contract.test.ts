import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createContract } from './contract.js';

describe('createContract', () => {
    it('throws when a route has an empty body schema', () => {
        expect(() =>
            createContract({
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
            createContract({
                users: createContract({
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
                }),
            })
        ).toThrowError('Route "update" has an empty body schema');
    });

    it('accepts a route with a non-empty body schema', () => {
        expect(() =>
            createContract({
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
            createContract({
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
            createContract({
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
});
