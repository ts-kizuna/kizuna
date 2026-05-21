import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createContract } from '@ts-kizuna/core';
import { createApi } from './adapter.js';
import { matchRoute } from './route-matcher.js';

const contract = createContract({
    getUser: {
        method: 'GET',
        path: '/users/:id',
        responses: {
            200: z.object({
                id: z.string(),
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
    getUserPosts: {
        method: 'GET',
        path: '/users/:userId/posts/:postId',
        responses: {
            200: z.object({
                id: z.string(),
            }),
        },
    },
    listUsers: {
        method: 'GET',
        path: '/users',
        responses: {
            200: z.object({
                users: z.array(z.string()),
            }),
        },
    },
});

describe('duplicate route detection', () => {
    it('throws on exact duplicate method + path', () => {
        expect(() =>
            createApi(
                createContract({
                    getUser: {
                        method: 'GET',
                        path: '/users/:id',
                        responses: { 200: z.string() },
                    },
                    fetchUser: {
                        method: 'GET',
                        path: '/users/:id',
                        responses: { 200: z.string() },
                    },
                })
            )
        ).toThrow(/fetchUser.*conflicts with.*getUser|getUser.*conflicts with.*fetchUser/);
    });

    it('throws on parametric conflict (same structure, different param names)', () => {
        expect(() =>
            createApi(
                createContract({
                    getUser: {
                        method: 'GET',
                        path: '/users/:id',
                        responses: { 200: z.string() },
                    },
                    fetchUser: {
                        method: 'GET',
                        path: '/users/:userId',
                        responses: { 200: z.string() },
                    },
                })
            )
        ).toThrow(/conflicts with/);
    });

    it('throws on duplicate across nested sub-contracts with dot-notated keys in message', () => {
        expect(() =>
            createApi(
                createContract({
                    users: {
                        getUser: {
                            method: 'GET',
                            path: '/users/:id',
                            responses: { 200: z.string() },
                        },
                    },
                    legacy: {
                        getUser: {
                            method: 'GET',
                            path: '/users/:id',
                            responses: { 200: z.string() },
                        },
                    },
                })
            )
        ).toThrow(/users\.getUser|legacy\.getUser/);
    });
});

describe('matchRoute', () => {
    const matched = (result: ReturnType<typeof matchRoute>) => {
        if (result.kind !== 'matched') throw new Error(`expected match, got ${result.kind}`);
        return result.match;
    };

    it('matches GET /users/:id', () => {
        const match = matched(matchRoute('GET', '/users/123', contract));
        expect(match.routeKey).toBe('getUser');
        expect(match.params).toEqual({
            id: '123',
        });
    });

    it('matches POST /users', () => {
        expect(matched(matchRoute('POST', '/users', contract)).routeKey).toBe('createUser');
    });

    it('matches multi-param routes', () => {
        const match = matched(matchRoute('GET', '/users/1/posts/2', contract));
        expect(match.routeKey).toBe('getUserPosts');
        expect(match.params).toEqual({
            userId: '1',
            postId: '2',
        });
    });

    it('distinguishes /users from /users/:id', () => {
        expect(matched(matchRoute('GET', '/users', contract)).routeKey).toBe('listUsers');
        expect(matched(matchRoute('GET', '/users/123', contract)).routeKey).toBe('getUser');
    });

    it('returns method-mismatch for the wrong method', () => {
        const result = matchRoute('DELETE', '/users/123', contract);
        expect(result.kind).toBe('method-mismatch');
        if (result.kind === 'method-mismatch') {
            expect(result.allowed).toEqual(['GET']);
        }
    });

    it('returns not-found for an unknown path', () => {
        expect(matchRoute('GET', '/unknown/path', contract).kind).toBe('not-found');
    });

    it('strips basePath before matching', () => {
        const match = matched(matchRoute('GET', '/api/users/123', contract, '/api'));
        expect(match.routeKey).toBe('getUser');
        expect(match.params).toEqual({
            id: '123',
        });
    });

    it('decodes URL-encoded path params', () => {
        const match = matched(matchRoute('GET', '/users/a%20b', contract));
        expect(match.params).toEqual({
            id: 'a b',
        });
    });

    it('prefers static segments over parameterized ones regardless of declaration order', () => {
        const c = createContract({
            addItem: {
                method: 'POST',
                path: '/cart/:itemId',
                responses: { 200: z.object({ ok: z.boolean() }) },
            },
            checkout: {
                method: 'POST',
                path: '/cart/checkout',
                responses: { 200: z.object({ ok: z.boolean() }) },
            },
        });
        const match = matched(matchRoute('POST', '/cart/checkout', c));
        expect(match.routeKey).toBe('checkout');
    });

    it('prefers static over dynamic at the same segment position with equal param counts', () => {
        const c = createContract({
            getByUserId: {
                method: 'GET',
                path: '/users/:id',
                responses: { 200: z.object({ id: z.string() }) },
            },
            getMe: {
                method: 'GET',
                path: '/users/me',
                responses: { 200: z.object({ id: z.string() }) },
            },
        });
        const match = matched(matchRoute('GET', '/users/me', c));
        expect(match.routeKey).toBe('getMe');
    });

    it('prefers static over dynamic in deeper paths with equal param counts', () => {
        const c = createContract({
            getUserPosts: {
                method: 'GET',
                path: '/users/:id/posts',
                responses: { 200: z.object({ id: z.string() }) },
            },
            getMyPosts: {
                method: 'GET',
                path: '/users/me/posts',
                responses: { 200: z.object({ id: z.string() }) },
            },
        });
        const match = matched(matchRoute('GET', '/users/me/posts', c));
        expect(match.routeKey).toBe('getMyPosts');
    });

    it('matches distinct routes with identical structure but different static segments', () => {
        const c = createContract({
            getUserPosts: {
                method: 'GET',
                path: '/users/:id/posts',
                responses: { 200: z.object({ id: z.string() }) },
            },
            getUserThings: {
                method: 'GET',
                path: '/users/:id/things',
                responses: { 200: z.object({ id: z.string() }) },
            },
        });
        expect(matched(matchRoute('GET', '/users/42/posts', c)).routeKey).toBe('getUserPosts');
        expect(matched(matchRoute('GET', '/users/42/things', c)).routeKey).toBe('getUserThings');
    });
});
