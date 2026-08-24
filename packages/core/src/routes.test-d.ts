import { expectTypeOf, test } from 'vitest';
import { z } from 'zod';

import { Kizuna } from './kizuna.js';

const plain = new Kizuna();

const routes = plain.routes({
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
    plain.routes({ bad: { method: 'GET', path: 'users/:id', responses: { 200: z.string() } } });
});

const groups = Kizuna.groups({
    users: {
        title: 'Users',
        description: 'User management routes',
    },
    health: {
        title: 'Health',
    },
});

const grouped = new Kizuna({
    groups,
});

const tagged = grouped.routes.users({
    getUser: {
        method: 'GET',
        path: '/users/:id',
        groups: ['health'],
        responses: {
            200: z.object({
                id: z.string(),
            }),
        },
    },
});

test('grouped routes preserve literal types', () => {
    expectTypeOf(tagged.getUser.method).toEqualTypeOf<'GET'>();
    expectTypeOf(tagged.getUser.path).toEqualTypeOf<'/users/:id'>();
});

test('a group must be declared', () => {
    // @ts-expect-error the set declares no `unknown` group
    grouped.routes.unknown({
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

test('route-level groups must be declared paths', () => {
    grouped.routes.users({
        getUser: {
            method: 'GET',
            path: '/users/:id',
            // @ts-expect-error the set declares no `unknown` group
            groups: ['unknown'],
            responses: {
                200: z.object({
                    id: z.string(),
                }),
            },
        },
    });
});

test('the root group accepts routes with no group', () => {
    plain.routes({
        getUser: {
            method: 'GET',
            path: '/users/:id',
            groups: ['anything'],
            responses: {
                200: z.object({
                    id: z.string(),
                }),
            },
        },
    });
});

test('pathParams keys must match the path placeholders', () => {
    plain.routes({
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
    plain.routes({
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
    const checked = plain.routes({
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
    plain.routes({
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
    plain.routes({
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
