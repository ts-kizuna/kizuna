import { expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { tagRoutes } from './routes.js';
import { Kizuna } from './namespace.js';

const routes = tagRoutes({
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
});

test('routes preserves literal method and path strings', () => {
    expectTypeOf(routes.getUser.method).toEqualTypeOf<'GET'>();
    expectTypeOf(routes.getUser.path).toEqualTypeOf<'/users/:id'>();
    expectTypeOf(routes.createUser.method).toEqualTypeOf<'POST'>();
    expectTypeOf(routes.createUser.path).toEqualTypeOf<'/users'>();
});

test('createUser has body, getUser does not', () => {
    expectTypeOf(routes.createUser.body).not.toBeUndefined();
    expectTypeOf(routes.getUser).not.toHaveProperty('body');
});

test('path must start with /', () => {
    // @ts-expect-error path must start with /
    tagRoutes({ bad: { method: 'GET', path: 'users/:id', responses: { 200: z.string() } } });
});

const tags = Kizuna.tags({
    users: {
        title: 'Users',
        description: 'User management endpoints',
    },
    health: {
        title: 'Health',
    },
});

const tagged = tagRoutes(tags, 'users', {
    getUser: {
        method: 'GET',
        path: '/users/:id',
        tags: ['health'],
        responses: {
            200: z.object({
                id: z.string(),
            }),
        },
    },
});

test('tagged routes preserves literal types', () => {
    expectTypeOf(tagged.getUser.method).toEqualTypeOf<'GET'>();
    expectTypeOf(tagged.getUser.path).toEqualTypeOf<'/users/:id'>();
});

test('group key must be a declared tag key', () => {
    // @ts-expect-error 'unknown' is not a declared tag key
    tagRoutes(tags, 'unknown', {
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
});

test('route-level tags must be declared tag keys', () => {
    tagRoutes(tags, 'users', {
        getUser: {
            method: 'GET',
            path: '/users/:id',
            // @ts-expect-error 'unknown' is not a declared tag key
            tags: ['unknown'],
            responses: {
                200: z.object({
                    id: z.string(),
                }),
            },
        },
    });
});

test('tagless tagRoutes accepts arbitrary tag strings', () => {
    tagRoutes({
        getUser: {
            method: 'GET',
            path: '/users/:id',
            tags: ['anything'],
            responses: {
                200: z.object({
                    id: z.string(),
                }),
            },
        },
    });
});

test('pathParams keys must match the path placeholders', () => {
    tagRoutes({
        getPlace: {
            method: 'GET',
            path: '/places/:plackeId',
            // @ts-expect-error 'placeId' is not a parameter in '/places/:plackeId'
            pathParams: z.object({
                placeId: z.uuid(),
            }),
            responses: {
                200: z.object({
                    id: z.string(),
                }),
            },
        },
    });
});

test('every path placeholder must appear in pathParams', () => {
    tagRoutes({
        getVisit: {
            method: 'GET',
            path: '/places/:placeId/visits/:visitId',
            // @ts-expect-error 'visitId' is missing from pathParams
            pathParams: z.object({
                placeId: z.uuid(),
            }),
            responses: {
                200: z.object({
                    id: z.string(),
                }),
            },
        },
    });
});

test('matching pathParams are accepted, in nested groups too', () => {
    const checked = tagRoutes({
        getPlace: {
            method: 'GET',
            path: '/places/:placeId',
            pathParams: z.object({
                placeId: z.uuid(),
            }),
            responses: {
                200: z.object({
                    id: z.string(),
                }),
            },
        },
        visits: {
            getVisit: {
                method: 'GET',
                path: '/places/:placeId/visits/:visitId',
                pathParams: z.object({
                    placeId: z.uuid(),
                    visitId: z.uuid(),
                }),
                responses: {
                    200: z.object({
                        id: z.string(),
                    }),
                },
            },
        },
    });
    expectTypeOf(checked.getPlace.path).toEqualTypeOf<'/places/:placeId'>();
    expectTypeOf(checked.visits.getVisit.path).toEqualTypeOf<'/places/:placeId/visits/:visitId'>();
});

test('routes that omit pathParams are left alone', () => {
    tagRoutes({
        getPlace: {
            method: 'GET',
            path: '/places/:placeId',
            responses: {
                200: z.object({
                    id: z.string(),
                }),
            },
        },
    });
});

test('a pathParams schema without a known key set switches the check off', () => {
    tagRoutes({
        getPlace: {
            method: 'GET',
            path: '/places/:placeId',
            pathParams: z.record(z.string(), z.string()),
            responses: {
                200: z.object({
                    id: z.string(),
                }),
            },
        },
    });
});
