import { beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { kizuna, createTags, createIdentity } from '@ts-kizuna/core';
import { ProblemDetailsSchema } from '@ts-kizuna/core/schemas';
import {
    createApi,
    createGuard,
    createMiddleware,
    createNextEndpoints,
    createRouter,
    createServer,
    NextRequest,
    NextResponse,
} from './index.js';

const { k } = kizuna({
    tags: createTags({
        api: 'API',
    }),
});

const contractRoutes = k.routes('api', {
    getUser: {
        method: 'GET',
        path: '/users/:id',
        responses: {
            200: z.object({
                id: z.string(),
                name: z.string(),
            }),
            404: ProblemDetailsSchema,
        },
    },
    createUser: {
        method: 'POST',
        path: '/users',
        body: z.object({
            name: z.string().min(1),
            email: z.email(),
        }),
        responses: {
            201: z.object({
                id: z.string(),
                name: z.string(),
                email: z.string(),
            }),
        },
    },
});

const contract = k.contract({
    routes: contractRoutes,
});

describe('createRouter — accepts a contract or a bare route group', () => {
    it('types handlers from a bare route group and from a full contract', () => {
        // Bare route group — no `{ routes: ... }` wrapper.
        const groupRouter = createRouter(contractRoutes, {
            getUser: ({ params }) => ({ status: 200, body: { id: params.id, name: 'x' } }),
            createUser: ({ body }) => ({ status: 201, body: { id: '1', name: body.name, email: body.email } }),
        });

        // Full contract — the existing form still works.
        const contractRouter = createRouter(contract, groupRouter);

        expect(typeof groupRouter.getUser).toBe('function');
        expect(typeof contractRouter.getUser).toBe('function');
    });
});

describe('createServer — router accepts a bare route group', () => {
    const usersRoutes = k.routes('api', {
        getUser: {
            method: 'GET',
            path: '/sub-users/:id',
            responses: {
                200: z.object({
                    id: z.string(),
                }),
            },
        },
    });

    const subContract = k.contract({
        routes: {
            users: usersRoutes,
        },
    });

    it('types a sub-router from a bare route group and serves it composed into the contract', async () => {
        const { server } = createServer(subContract);

        const usersRouter = server.router(usersRoutes, {
            getUser: ({ params }) => {
                expectTypeOf(params).toEqualTypeOf<{ id: string }>();
                return {
                    status: 200,
                    body: {
                        id: params.id,
                    },
                };
            },
        });

        const composed = server.router({
            users: usersRouter,
        });

        const { GET: subGET } = createNextEndpoints(
            server.api({
                router: composed,
            }),
            {
                basePath: '/api',
            }
        );

        const response = await subGET(new NextRequest('http://localhost:3000/api/sub-users/42', { method: 'GET' }));
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.id).toBe('42');
    });

    it('contextually types the bare group without widening', () => {
        const { server } = createServer(subContract);

        // @ts-expect-error 418 is not a declared response of getUser.
        server.router(usersRoutes, {
            getUser: () => ({
                status: 418,
                body: {
                    id: '1',
                },
            }),
        });
    });
});

interface User {
    id: string;
    name: string;
    email: string;
}
const users = new Map<string, User>();

const api = createApi({
    contract,
    router: {
        getUser: ({ params }) => {
            const user = users.get(params.id);
            if (!user) {
                return {
                    status: 404,
                    body: {
                        detail: 'Not found',
                    },
                };
            }
            return {
                status: 200,
                body: {
                    id: user.id,
                    name: user.name,
                },
            };
        },
        createUser: ({ body }) => {
            const id = String(users.size + 1);
            const user: User = {
                id,
                name: body.name,
                email: body.email,
            };
            users.set(id, user);
            return {
                status: 201,
                body: user,
            };
        },
    },
});

const { GET, POST, DELETE } = createNextEndpoints(api, {
    basePath: '/api',
});

const makeRequest = (method: string, path: string, body?: unknown): NextRequest => {
    const url = `http://localhost:3000${path}`;
    const init: ConstructorParameters<typeof NextRequest>[1] = {
        method,
    };
    if (body !== undefined) {
        init.body = JSON.stringify(body);
        init.headers = {
            'content-type': 'application/json',
        };
    }
    return new NextRequest(url, init);
};

describe('Next.js handler', () => {
    beforeEach(() => {
        users.clear();
    });

    it('handles POST with body validation', async () => {
        const response = await POST(
            makeRequest('POST', '/api/users', {
                name: 'Alice',
                email: 'alice@test.com',
            })
        );
        expect(response.status).toBe(201);
        const body = await response.json();
        expect(body.name).toBe('Alice');
        expect(body.email).toBe('alice@test.com');
    });

    it('handles GET with path params', async () => {
        const created = await POST(
            makeRequest('POST', '/api/users', {
                name: 'Bob',
                email: 'bob@test.com',
            })
        );
        const createdBody = await created.json();

        const response = await GET(makeRequest('GET', `/api/users/${createdBody.id}`));
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.name).toBe('Bob');
    });

    it('returns 400 for invalid body', async () => {
        const response = await POST(
            makeRequest('POST', '/api/users', {
                name: '',
                email: 'not-email',
            })
        );
        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.detail).toBe('Invalid request body');
        expect(Array.isArray(body.errors)).toBe(true);
    });

    it('returns 404 for an unmatched route', async () => {
        const response = await GET(makeRequest('GET', '/api/unknown'));
        expect(response.status).toBe(404);
    });

    it('returns 405 with Allow header on method mismatch', async () => {
        const response = await DELETE(makeRequest('DELETE', '/api/users/123'));
        expect(response.status).toBe(405);
        expect(response.headers.get('allow')).toBe('GET');
        const body = await response.json();
        expect(body.allowed).toEqual(['GET']);
    });

    it('returns 415 when Content-Type does not match route expectation', async () => {
        const url = 'http://localhost:3000/api/users';
        const response = await POST(
            new NextRequest(url, {
                method: 'POST',
                body: '<user><name>Bob</name></user>',
                headers: {
                    'content-type': 'application/xml',
                },
            })
        );
        expect(response.status).toBe(415);
        const body = await response.json();
        expect(body.detail).toContain('Unsupported Media Type');
        expect(body.detail).toContain('application/json');
        expect(body.detail).toContain('application/xml');
    });

    it('returns 404 for a missing user', async () => {
        const response = await GET(makeRequest('GET', '/api/users/missing'));
        expect(response.status).toBe(404);
        const body = await response.json();
        expect(body.detail).toBe('Not found');
    });

    it('routes onError hook overrides the default 500', async () => {
        const throwingRoutes = k.routes('api', {
            boom: {
                method: 'GET',
                path: '/boom',
                responses: {
                    200: z.object({
                        ok: z.boolean(),
                    }),
                },
            },
        });
        const throwingContract = k.contract({
            routes: throwingRoutes,
        });
        const throwingApi = createApi({
            contract: throwingContract,
            router: {
                boom: () => {
                    throw new Error('handler exploded');
                },
            },
            onError: () =>
                new NextResponse(JSON.stringify({ caught: true }), {
                    status: 503,
                    headers: {
                        'content-type': 'application/json',
                    },
                }),
        });
        const { GET: boomGET } = createNextEndpoints(throwingApi, {
            basePath: '/api',
        });
        const response = await boomGET(makeRequest('GET', '/api/boom'));
        expect(response.status).toBe(503);
        const body = await response.json();
        expect(body.caught).toBe(true);
    });
});

describe('Next.js handler — alternate content types', () => {
    const uploadRoutes = k.routes('api', {
        uploadAvatar: {
            method: 'POST',
            path: '/avatar',
            contentType: 'multipart/form-data',
            body: z.object({
                file: z.instanceof(File),
                userId: z.string(),
            }),
            responses: {
                200: z.object({
                    size: z.number(),
                    contents: z.string(),
                    userId: z.string(),
                }),
            },
        },
        submitForm: {
            method: 'POST',
            path: '/form',
            contentType: 'application/x-www-form-urlencoded',
            body: z.object({
                name: z.string(),
                age: z.string(),
            }),
            responses: {
                200: z.object({
                    name: z.string(),
                    age: z.string(),
                }),
            },
        },
    });
    const uploadContract = k.contract({
        routes: uploadRoutes,
    });
    const uploadApi = createApi({
        contract: uploadContract,
        router: {
            uploadAvatar: async ({ body }) => {
                const contents = await body.file.text();
                return {
                    status: 200,
                    body: {
                        size: contents.length,
                        contents,
                        userId: body.userId,
                    },
                };
            },
            submitForm: ({ body }) => {
                return {
                    status: 200,
                    body: {
                        name: body.name,
                        age: body.age,
                    },
                };
            },
        },
    });

    const { POST: uploadPOST } = createNextEndpoints(uploadApi, {
        basePath: '/api',
    });

    it('parses multipart/form-data and validates File fields', async () => {
        const form = new FormData();
        form.append('file', new File(['hello world'], 'avatar.txt'));
        form.append('userId', 'u1');
        const request = new NextRequest('http://localhost:3000/api/avatar', {
            method: 'POST',
            body: form,
        });

        const response = await uploadPOST(request);
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.size).toBe(11);
        expect(body.contents).toBe('hello world');
        expect(body.userId).toBe('u1');
    });

    it('parses application/x-www-form-urlencoded bodies', async () => {
        const request = new NextRequest('http://localhost:3000/api/form', {
            method: 'POST',
            body: 'name=Alice&age=30',
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
            },
        });

        const response = await uploadPOST(request);
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body).toEqual({
            name: 'Alice',
            age: '30',
        });
    });
});

describe('Next.js handler — all HTTP methods', () => {
    const allMethodsContractRoutes = k.routes('api', {
        getItem: {
            method: 'GET',
            path: '/items/:id',
            responses: {
                200: z.object({
                    method: z.string(),
                }),
            },
        },
        headItem: {
            method: 'HEAD',
            path: '/items/:id',
            responses: {
                200: z.object({
                    method: z.string(),
                }),
            },
        },
        createItem: {
            method: 'POST',
            path: '/items',
            body: z.object({
                name: z.string(),
            }),
            responses: {
                200: z.object({
                    method: z.string(),
                }),
            },
        },
        replaceItem: {
            method: 'PUT',
            path: '/items/:id',
            body: z.object({
                name: z.string(),
            }),
            responses: {
                200: z.object({
                    method: z.string(),
                }),
            },
        },
        patchItem: {
            method: 'PATCH',
            path: '/items/:id',
            body: z.object({
                name: z.string(),
            }),
            responses: {
                200: z.object({
                    method: z.string(),
                }),
            },
        },
        deleteItem: {
            method: 'DELETE',
            path: '/items/:id',
            responses: {
                200: z.object({
                    method: z.string(),
                }),
            },
        },
        optionsItem: {
            method: 'OPTIONS',
            path: '/items/:id',
            responses: {
                200: z.object({
                    method: z.string(),
                }),
            },
        },
    });

    const allMethodsContract = k.contract({
        routes: allMethodsContractRoutes,
    });

    const echoMethod = (method: string) => () => ({
        status: 200 as const,
        body: {
            method,
        },
    });

    const allMethodsApi = createApi({
        contract: allMethodsContract,
        router: {
            getItem: echoMethod('GET'),
            headItem: echoMethod('HEAD'),
            createItem: echoMethod('POST'),
            replaceItem: echoMethod('PUT'),
            patchItem: echoMethod('PATCH'),
            deleteItem: echoMethod('DELETE'),
            optionsItem: echoMethod('OPTIONS'),
        },
    });

    const { GET: handler } = createNextEndpoints(allMethodsApi);

    const makeMethodRequest = (method: string, path: string, body?: unknown) =>
        new NextRequest(`http://localhost:3000${path}`, {
            method,
            ...(body !== undefined
                ? {
                      body: JSON.stringify(body),
                      headers: {
                          'content-type': 'application/json',
                      },
                  }
                : {}),
        });

    it('GET routes correctly', async () => {
        const response = await handler(makeMethodRequest('GET', '/items/1'));
        expect(response.status).toBe(200);
        expect((await response.json()).method).toBe('GET');
    });

    it('HEAD routes correctly and strips the response body', async () => {
        const response = await handler(makeMethodRequest('HEAD', '/items/1'));
        expect(response.status).toBe(200);
        expect(await response.text()).toBe('');
    });

    it('POST routes correctly', async () => {
        const response = await handler(makeMethodRequest('POST', '/items', { name: 'x' }));
        expect(response.status).toBe(200);
        expect((await response.json()).method).toBe('POST');
    });

    it('PUT routes correctly', async () => {
        const response = await handler(makeMethodRequest('PUT', '/items/1', { name: 'x' }));
        expect(response.status).toBe(200);
        expect((await response.json()).method).toBe('PUT');
    });

    it('PATCH routes correctly', async () => {
        const response = await handler(makeMethodRequest('PATCH', '/items/1', { name: 'x' }));
        expect(response.status).toBe(200);
        expect((await response.json()).method).toBe('PATCH');
    });

    it('DELETE routes correctly', async () => {
        const response = await handler(makeMethodRequest('DELETE', '/items/1'));
        expect(response.status).toBe(200);
        expect((await response.json()).method).toBe('DELETE');
    });

    it('OPTIONS routes correctly', async () => {
        const response = await handler(makeMethodRequest('OPTIONS', '/items/1'));
        expect(response.status).toBe(200);
        expect((await response.json()).method).toBe('OPTIONS');
    });

    it('OPTIONS response includes Allow header listing all methods for the path', async () => {
        const response = await handler(makeMethodRequest('OPTIONS', '/items/1'));
        expect(response.status).toBe(200);
        const allow = response.headers.get('allow') ?? '';
        expect(allow).toContain('GET');
        expect(allow).toContain('PUT');
        expect(allow).toContain('PATCH');
        expect(allow).toContain('DELETE');
        expect(allow).toContain('OPTIONS');
    });
});

describe('Next.js handler — responseValidation', () => {
    it('returns 500 when responseValidation is enabled and the handler returns a mismatched body', async () => {
        const strictRoutes = k.routes('api', {
            getItem: {
                method: 'GET',
                path: '/items/:id',
                responses: {
                    200: z.object({
                        id: z.string(),
                    }),
                },
            },
        });
        const strictContract = k.contract({
            routes: strictRoutes,
        });
        const strictApi = createApi({
            contract: strictContract,
            router: {
                getItem: () => ({ status: 200, body: { id: 123 } }) as any,
            },
        });
        const { GET: strictGET } = createNextEndpoints(strictApi, {
            responseValidation: true,
        });
        const response = await strictGET(new NextRequest('http://localhost:3000/items/1'));
        expect(response.status).toBe(500);
    });
});

describe('Next.js handler — Accept header / 406', () => {
    it('returns 406 when Accept excludes application/json', async () => {
        const response = await GET(
            new NextRequest('http://localhost:3000/api/users/1', {
                method: 'GET',
                headers: {
                    accept: 'text/html',
                },
            })
        );
        expect(response.status).toBe(406);
        const body = await response.json();
        expect(body.detail).toBe('Not Acceptable');
    });

    it('returns 200 when Accept is */*', async () => {
        const response = await GET(
            new NextRequest('http://localhost:3000/api/users/1', {
                method: 'GET',
                headers: {
                    accept: '*/*',
                },
            })
        );
        expect(response.status).not.toBe(406);
    });

    it('returns 200 when Accept includes application/json', async () => {
        const response = await GET(
            new NextRequest('http://localhost:3000/api/users/1', {
                method: 'GET',
                headers: {
                    accept: 'text/html, application/json',
                },
            })
        );
        expect(response.status).not.toBe(406);
    });

    it('returns 200 when Accept is absent', async () => {
        const response = await GET(makeRequest('GET', '/api/users/1'));
        expect(response.status).not.toBe(406);
    });
});

describe('Next.js handler — requestMiddleware', () => {
    const middlewareContractRoutes = k.routes('api', {
        getResource: {
            method: 'GET',
            path: '/resources/:id',
            responses: {
                200: z.object({
                    id: z.string(),
                    userId: z.string(),
                }),
            },
        },
    });

    const middlewareContract = k.contract({
        routes: middlewareContractRoutes,
    });

    it('runs requestMiddleware before the handler with the matched route', async () => {
        const routesSeen: Array<{ path: string; method: string }> = [];

        const middlewareApi = createApi({
            contract: middlewareContract,
            router: {
                getResource: ({ params, request }) => ({
                    status: 200,
                    body: {
                        id: params.id,
                        userId: (request as any).userId,
                    },
                }),
            },
        });

        const { GET: middlewareGET } = createNextEndpoints(middlewareApi, {
            basePath: '/api',
            requestMiddleware: [
                async (request, route) => {
                    routesSeen.push(route);
                    (request as any).userId = 'user-42';
                },
            ],
        });

        const response = await middlewareGET(makeRequest('GET', '/api/resources/7'));
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.id).toBe('7');
        expect(body.userId).toBe('user-42');
        expect(routesSeen).toEqual([
            {
                path: '/resources/:id',
                method: 'GET',
            },
        ]);
    });

    it('short-circuits when middleware returns a Response', async () => {
        let handlerCalled = false;

        const middlewareApi = createApi({
            contract: middlewareContract,
            router: {
                getResource: ({ params }) => {
                    handlerCalled = true;
                    return {
                        status: 200,
                        body: {
                            id: params.id,
                            userId: '',
                        },
                    };
                },
            },
        });

        const { GET: middlewareGET } = createNextEndpoints(middlewareApi, {
            basePath: '/api',
            requestMiddleware: [
                async () => {
                    return new Response(JSON.stringify({ message: 'Forbidden' }), {
                        status: 403,
                        headers: {
                            'content-type': 'application/json',
                        },
                    });
                },
            ],
        });

        const response = await middlewareGET(makeRequest('GET', '/api/resources/1'));
        expect(response.status).toBe(403);
        const body = await response.json();
        expect(body.message).toBe('Forbidden');
        expect(handlerCalled).toBe(false);
    });

    it('runs middleware functions in order and stops at the first Response', async () => {
        const order: number[] = [];

        const middlewareApi = createApi({
            contract: middlewareContract,
            router: {
                getResource: ({ params }) => ({
                    status: 200,
                    body: {
                        id: params.id,
                        userId: '',
                    },
                }),
            },
        });

        const { GET: middlewareGET } = createNextEndpoints(middlewareApi, {
            basePath: '/api',
            requestMiddleware: [
                async () => {
                    order.push(1);
                },
                async () => {
                    order.push(2);
                    return new Response(null, { status: 401 });
                },
                async () => {
                    order.push(3);
                },
            ],
        });

        const response = await middlewareGET(makeRequest('GET', '/api/resources/1'));
        expect(response.status).toBe(401);
        expect(order).toEqual([1, 2]);
    });

    it('skips middleware for unmatched routes and returns 404', async () => {
        let middlewareCalled = false;

        const middlewareApi = createApi({
            contract: middlewareContract,
            router: {
                getResource: ({ params }) => ({
                    status: 200,
                    body: {
                        id: params.id,
                        userId: '',
                    },
                }),
            },
        });

        const { GET: middlewareGET } = createNextEndpoints(middlewareApi, {
            basePath: '/api',
            requestMiddleware: [
                async () => {
                    middlewareCalled = true;
                },
            ],
        });

        const response = await middlewareGET(makeRequest('GET', '/api/unknown'));
        expect(response.status).toBe(404);
        expect(middlewareCalled).toBe(false);
    });
});

describe('Next.js — guards', () => {
    const user = createIdentity.bearer({
        context: z.object({
            userId: z.string(),
        }),
    });

    const { k: securedK } = kizuna({
        identities: {
            user,
        },
    });

    const securedRoutes = securedK.routes({
        publicRoute: {
            method: 'GET',
            path: '/public',
            responses: {
                200: z.object({
                    message: z.string(),
                }),
            },
        },
        whoAmI: {
            method: 'GET',
            path: '/who-am-i',
            responses: {
                200: z.object({
                    userId: z.string(),
                }),
            },
        },
    });

    const securedContract = securedK.contract({
        routes: {
            api: securedRoutes,
        },
        auth: {
            api: {
                '*': false,
                whoAmI: 'user',
            },
        },
    });

    const requireUser = createGuard(securedContract, 'user', ({ bearer, deny }) => {
        if (bearer?.token !== 'tok_ada') return deny(401, 'Unauthorized');
        return {
            userId: '1',
        };
    });

    const makeEndpoints = () => {
        const api = createApi({
            contract: securedContract,
            router: {
                api: {
                    publicRoute: () => ({
                        status: 200,
                        body: {
                            message: 'public',
                        },
                    }),
                    whoAmI: ({ auth }) => ({
                        status: 200,
                        body: {
                            userId: auth.user.userId,
                        },
                    }),
                },
            },
            guards: {
                user: requireUser,
            },
        });
        return createNextEndpoints(api, {
            basePath: '',
        });
    };

    it('serves a public route without credentials', async () => {
        const { GET } = makeEndpoints();
        const response = await GET(makeRequest('GET', '/public'));
        expect(response.status).toBe(200);
    });

    it('denies a secured route without a credential as problem details', async () => {
        const { GET } = makeEndpoints();
        const response = await GET(makeRequest('GET', '/who-am-i'));
        expect(response.status).toBe(401);
        expect(response.headers.get('content-type')).toContain('application/problem+json');
        const body = await response.json();
        expect(body.detail).toBe('Unauthorized');
    });

    it('passes the guard context to the handler', async () => {
        const { GET } = makeEndpoints();
        const authedRequest = makeRequest('GET', '/who-am-i');
        authedRequest.headers.set('authorization', 'Bearer tok_ada');
        const response = await GET(authedRequest);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            userId: '1',
        });
    });
});

describe('Next.js — middleware map', () => {
    const middlewareContractRoutes = k.routes('api', {
        publicRoute: {
            method: 'GET',
            path: '/public',
            responses: {
                200: z.object({
                    message: z.string(),
                }),
            },
        },
        protectedRoute: {
            method: 'GET',
            path: '/protected',
            responses: {
                200: z.object({
                    message: z.string(),
                }),
            },
        },
        admin: {
            dashboard: {
                method: 'GET',
                path: '/admin/dashboard',
                responses: {
                    200: z.object({
                        message: z.string(),
                    }),
                },
            },
            settings: {
                method: 'GET',
                path: '/admin/settings',
                responses: {
                    200: z.object({
                        message: z.string(),
                    }),
                },
            },
        },
    });

    const middlewareContract = k.contract({
        routes: middlewareContractRoutes,
    });

    const requireAuth = (request: NextRequest) => {
        const token = request.headers.get('authorization');
        if (!token || token !== 'Bearer valid') {
            return new Response(
                JSON.stringify({
                    error: 'Unauthorized',
                }),
                {
                    status: 401,
                }
            );
        }
    };

    it('applies middleware to a specific route', async () => {
        const middleware = createMiddleware(middlewareContract, {
            publicRoute: [],
            protectedRoute: [requireAuth],
            admin: [],
        });
        const middlewareApi = createApi({
            contract: middlewareContract,
            router: {
                publicRoute: () => ({
                    status: 200,
                    body: {
                        message: 'public',
                    },
                }),
                protectedRoute: () => ({
                    status: 200,
                    body: {
                        message: 'protected',
                    },
                }),
                admin: {
                    dashboard: () => ({
                        status: 200,
                        body: {
                            message: 'dashboard',
                        },
                    }),
                    settings: () => ({
                        status: 200,
                        body: {
                            message: 'settings',
                        },
                    }),
                },
            },
            middleware,
        });
        const { GET } = createNextEndpoints(middlewareApi, {
            basePath: '',
        });

        const publicResponse = await GET(makeRequest('GET', '/public'));
        expect(publicResponse.status).toBe(200);

        const protectedNoAuth = await GET(makeRequest('GET', '/protected'));
        expect(protectedNoAuth.status).toBe(401);

        const protectedRequest = makeRequest('GET', '/protected');
        protectedRequest.headers.set('authorization', 'Bearer valid');
        const protectedWithAuth = await GET(protectedRequest);
        expect(protectedWithAuth.status).toBe(200);
    });

    it('applies group-level middleware to all routes in a group', async () => {
        const middleware = createMiddleware(middlewareContract, {
            publicRoute: [],
            protectedRoute: [],
            admin: [requireAuth],
        });
        const middlewareApi = createApi({
            contract: middlewareContract,
            router: {
                publicRoute: () => ({
                    status: 200,
                    body: {
                        message: 'public',
                    },
                }),
                protectedRoute: () => ({
                    status: 200,
                    body: {
                        message: 'unprotected here',
                    },
                }),
                admin: {
                    dashboard: () => ({
                        status: 200,
                        body: {
                            message: 'dashboard',
                        },
                    }),
                    settings: () => ({
                        status: 200,
                        body: {
                            message: 'settings',
                        },
                    }),
                },
            },
            middleware,
        });
        const { GET } = createNextEndpoints(middlewareApi, {
            basePath: '',
        });

        const dashboardNoAuth = await GET(makeRequest('GET', '/admin/dashboard'));
        expect(dashboardNoAuth.status).toBe(401);

        const settingsNoAuth = await GET(makeRequest('GET', '/admin/settings'));
        expect(settingsNoAuth.status).toBe(401);

        const publicResponse = await GET(makeRequest('GET', '/public'));
        expect(publicResponse.status).toBe(200);
    });
});
