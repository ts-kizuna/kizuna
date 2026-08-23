import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ROUTES_TAG, type Routes } from './types.js';
import { Kizuna } from './kizuna.js';

const k = new Kizuna({
    tags: Kizuna.tags({
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
                    // eslint-disable-next-line @ts-kizuna/no-unsupported-schema -- intentional, asserts k.routes throws on z.coerce
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
                        // eslint-disable-next-line @ts-kizuna/no-unsupported-schema -- intentional, asserts k.routes throws on z.coerce
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
                        // eslint-disable-next-line @ts-kizuna/no-unsupported-schema -- intentional, asserts k.routes throws on z.coerce
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
                            // eslint-disable-next-line @ts-kizuna/no-unsupported-schema -- intentional, asserts k.routes throws on z.coerce
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

describe('k.routes pathParams/path agreement', () => {
    it('throws when pathParams declares a key the path does not have', () => {
        expect(() =>
            k.routes('users', {
                getPlace: {
                    method: 'GET',
                    path: '/places/:plackeId',
                    // @ts-expect-error intentional, asserts k.routes throws on a mismatched key
                    pathParams: z.object({
                        placeId: z.uuid(),
                    }),
                    responses: {
                        200: z.object({
                            id: z.string(),
                        }),
                    },
                },
            })
        ).toThrowError(
            'Route "getPlace" has pathParams that do not match its path "/places/:plackeId": declared in pathParams but not in the path: placeId; in the path but not declared in pathParams: plackeId.'
        );
    });

    it('throws when the path has a placeholder pathParams omits', () => {
        expect(() =>
            k.routes('users', {
                getVisit: {
                    method: 'GET',
                    path: '/places/:placeId/visits/:visitId',
                    // @ts-expect-error intentional, asserts k.routes throws on a missing key
                    pathParams: z.object({
                        placeId: z.uuid(),
                    }),
                    responses: {
                        200: z.object({
                            id: z.string(),
                        }),
                    },
                },
            })
        ).toThrowError('in the path but not declared in pathParams: visitId.');
    });

    it('throws for a mismatch on a nested route', () => {
        expect(() =>
            k.routes('users', {
                management: {
                    getPlace: {
                        method: 'GET',
                        path: '/places/:placeId',
                        // @ts-expect-error intentional, asserts k.routes throws on a mismatched key
                        pathParams: z.object({
                            place: z.uuid(),
                        }),
                        responses: {
                            200: z.object({
                                id: z.string(),
                            }),
                        },
                    },
                },
            })
        ).toThrowError('Route "management.getPlace" has pathParams that do not match its path "/places/:placeId"');
    });

    it('accepts pathParams whose keys match the path', () => {
        expect(() =>
            k.routes('users', {
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
            })
        ).not.toThrow();
    });

    it('accepts a path parameter followed by a literal in the same segment', () => {
        expect(() =>
            k.routes('users', {
                getReport: {
                    method: 'GET',
                    path: '/reports/:reportId.pdf',
                    pathParams: z.object({
                        reportId: z.uuid(),
                    }),
                    responses: {
                        200: z.object({
                            id: z.string(),
                        }),
                    },
                },
            })
        ).not.toThrow();
    });

    it('accepts a route that omits pathParams entirely', () => {
        expect(() =>
            k.routes('users', {
                getPlace: {
                    method: 'GET',
                    path: '/places/:placeId',
                    responses: {
                        200: z.object({
                            id: z.string(),
                        }),
                    },
                },
            })
        ).not.toThrow();
    });

    it('leaves a pathParams schema without a known key set alone', () => {
        expect(() =>
            k.routes('users', {
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
            })
        ).not.toThrow();
    });
});

describe('k.routes structured path params', () => {
    const routeWith = (schema: z.ZodType) => () =>
        k.routes('users', {
            getPlace: {
                method: 'GET',
                path: '/places/:value',
                pathParams: z.object({
                    value: schema,
                }),
                responses: {
                    200: z.object({
                        id: z.string(),
                    }),
                },
            },
        });

    it('throws for every structured schema kind, naming the parameter and pointing at query', () => {
        expect(routeWith(z.object({ city: z.string() }))).toThrowError(
            'Route "getPlace" declares path parameter "value" as object. A path parameter arrives as a single string, so this is not supported.'
        );
        expect(routeWith(z.object({ city: z.string() }))).toThrowError(/move the value to query/);
        expect(routeWith(z.array(z.string()))).toThrowError('as array');
        expect(routeWith(z.record(z.string(), z.string()))).toThrowError('as record');
        expect(routeWith(z.tuple([z.string()]))).toThrowError('as tuple');
        expect(routeWith(z.map(z.string(), z.string()))).toThrowError('as map');
        expect(routeWith(z.set(z.string()))).toThrowError('as set');
    });

    it('accepts scalars, enums, and a string transform that yields an array', () => {
        expect(routeWith(z.uuid())).not.toThrow();
        expect(routeWith(z.int())).not.toThrow();
        expect(routeWith(z.date())).not.toThrow();
        expect(routeWith(z.enum(['city', 'region']))).not.toThrow();
        expect(routeWith(z.string().transform((value) => value.split(',')))).not.toThrow();
    });

    it('resolves a schema reached through a widened annotation', () => {
        const widened: z.ZodType = z.object({
            city: z.string(),
        });
        expect(routeWith(widened)).toThrowError('declares path parameter "value" as object');
    });

    it('leaves an array in query alone', () => {
        expect(() =>
            k.routes('users', {
                listPlaces: {
                    method: 'GET',
                    path: '/places',
                    query: z.object({
                        ids: z.array(z.string()),
                    }),
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

describe('file bodies require multipart', () => {
    it('throws when a body field declares a file on a JSON route', () => {
        expect(() =>
            k.routes('users', {
                uploadAvatar: {
                    method: 'POST',
                    path: '/avatar',
                    body: z.object({
                        file: z.instanceof(File),
                    }),
                    responses: {
                        200: z.object({
                            ok: z.boolean(),
                        }),
                    },
                },
            })
        ).toThrow(/body.file.*multipart/);
    });

    it('throws when the whole body is a file on a JSON route', () => {
        expect(() =>
            k.routes('users', {
                uploadReport: {
                    method: 'POST',
                    path: '/reports',
                    body: z.file(),
                    responses: {
                        200: z.object({
                            ok: z.boolean(),
                        }),
                    },
                },
            })
        ).toThrow(/file body/);
    });

    it('accepts a file field on a multipart route', () => {
        expect(() =>
            k.routes('users', {
                uploadAvatar: {
                    method: 'POST',
                    path: '/avatar',
                    contentType: 'multipart/form-data',
                    body: z.object({
                        file: z.instanceof(File),
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
