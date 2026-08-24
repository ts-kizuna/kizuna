import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { assembleApi } from './adapter.js';
import { matchRoute } from './route-matcher.js';
import { Kizuna } from './kizuna.js';

const k = new Kizuna({
    groups: Kizuna.groups({
        api: 'API',
    }),
});

const routes = k.routes.api({
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
        const duplicateRoutes = k.routes.api({
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
        });
        expect(() => assembleApi({ routes: duplicateRoutes }, { router: {} })).toThrow(
            /fetchUser.*collides with.*getUser|getUser.*collides with.*fetchUser/
        );
    });

    it('throws on parametric conflict (same structure, different param names)', () => {
        const conflictingRoutes = k.routes.api({
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
        });
        expect(() => assembleApi({ routes: conflictingRoutes }, { router: {} })).toThrow(/collides with/);
    });

    it('throws on duplicate across nested sub-routes with dot-notated keys in message', () => {
        const nestedRoutes = k.routes.api({
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
        });
        expect(() => assembleApi({ routes: nestedRoutes }, { router: {} })).toThrow(/users\.getUser|legacy\.getUser/);
    });
});

describe('matchRoute', () => {
    const matched = (result: ReturnType<typeof matchRoute>) => {
        if (result.kind !== 'matched') throw new Error(`expected match, got ${result.kind}`);
        return result.match;
    };

    it('matches GET /users/:id', () => {
        const match = matched(matchRoute('GET', '/users/123', routes));
        expect(match.routeKey).toBe('getUser');
        expect(match.params).toEqual({
            id: '123',
        });
    });

    it('matches POST /users', () => {
        expect(matched(matchRoute('POST', '/users', routes)).routeKey).toBe('createUser');
    });

    it('matches multi-param routes', () => {
        const match = matched(matchRoute('GET', '/users/1/posts/2', routes));
        expect(match.routeKey).toBe('getUserPosts');
        expect(match.params).toEqual({
            userId: '1',
            postId: '2',
        });
    });

    it('distinguishes /users from /users/:id', () => {
        expect(matched(matchRoute('GET', '/users', routes)).routeKey).toBe('listUsers');
        expect(matched(matchRoute('GET', '/users/123', routes)).routeKey).toBe('getUser');
    });

    it('returns method-mismatch for the wrong method, allowing HEAD alongside GET', () => {
        const result = matchRoute('DELETE', '/users/123', routes);
        expect(result.kind).toBe('method-mismatch');
        if (result.kind === 'method-mismatch') {
            expect(result.allowed).toEqual(['GET', 'HEAD']);
        }
    });

    it('returns not-found for an unknown path', () => {
        expect(matchRoute('GET', '/unknown/path', routes).kind).toBe('not-found');
    });

    it('serves HEAD from the GET route when no HEAD route is declared', () => {
        const match = matched(matchRoute('HEAD', '/users/123', routes));
        expect(match.routeKey).toBe('getUser');
        expect(match.params).toEqual({
            id: '123',
        });
    });

    it('prefers a declared HEAD route over the GET fallback', () => {
        const withHead = k.routes.api({
            getReport: {
                method: 'GET',
                path: '/report',
                responses: {
                    200: z.object({
                        rows: z.number(),
                    }),
                },
            },
            headReport: {
                method: 'HEAD',
                path: '/report',
                responses: {
                    200: z.object({
                        rows: z.number(),
                    }),
                },
            },
        });
        expect(matched(matchRoute('HEAD', '/report', withHead)).routeKey).toBe('headReport');
    });

    it('does not allow HEAD on a path without GET', () => {
        const postOnly = k.routes.api({
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
        });
        const mismatch = matchRoute('HEAD', '/users', postOnly);
        expect(mismatch.kind).toBe('method-mismatch');
        if (mismatch.kind === 'method-mismatch') {
            expect(mismatch.allowed).toEqual(['POST']);
        }
    });

    it('strips basePath before matching', () => {
        const match = matched(matchRoute('GET', '/api/users/123', routes, '/api'));
        expect(match.routeKey).toBe('getUser');
        expect(match.params).toEqual({
            id: '123',
        });
    });

    it('decodes URL-encoded path params', () => {
        const match = matched(matchRoute('GET', '/users/a%20b', routes));
        expect(match.params).toEqual({
            id: 'a b',
        });
    });

    it('prefers static segments over parameterized ones regardless of declaration order', () => {
        const cartRoutes = k.routes.api({
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
        const match = matched(matchRoute('POST', '/cart/checkout', cartRoutes));
        expect(match.routeKey).toBe('checkout');
    });

    it('prefers static over dynamic at the same segment position with equal param counts', () => {
        const meRoutes = k.routes.api({
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
        const match = matched(matchRoute('GET', '/users/me', meRoutes));
        expect(match.routeKey).toBe('getMe');
    });

    it('prefers static over dynamic in deeper paths with equal param counts', () => {
        const postRoutes = k.routes.api({
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
        const match = matched(matchRoute('GET', '/users/me/posts', postRoutes));
        expect(match.routeKey).toBe('getMyPosts');
    });

    it('matches distinct routes with identical structure but different static segments', () => {
        const collectionRoutes = k.routes.api({
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
        expect(matched(matchRoute('GET', '/users/42/posts', collectionRoutes)).routeKey).toBe('getUserPosts');
        expect(matched(matchRoute('GET', '/users/42/things', collectionRoutes)).routeKey).toBe('getUserThings');
    });
});
