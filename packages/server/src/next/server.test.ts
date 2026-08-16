import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Kizuna } from '@ts-kizuna/core';
import { ProblemDetailsSchema } from '@ts-kizuna/core/schemas';
import { KizunaServer, NextRequest, NextResponse } from './server.js';
import { readTestBody, testAdapterFeatures } from '../../../core/src/adapter-testing/index.js';

const k = new Kizuna({
    tags: Kizuna.tags({
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

interface User {
    id: string;
    name: string;
    email: string;
}
const users = new Map<string, User>();

const api = new KizunaServer(contract).api({
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

const { DELETE } = api.mount({
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

    it('returns 405 with Allow header on method mismatch', async () => {
        const response = await DELETE(makeRequest('DELETE', '/api/users/123'));
        expect(response.status).toBe(405);
        expect(response.headers.get('allow')).toBe('GET');
        const body = await response.json();
        expect(body.allowed).toEqual(['GET']);
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
        const throwingApi = new KizunaServer(throwingContract).api({
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
        const { GET: boomGET } = throwingApi.mount({
            basePath: '/api',
        });
        const response = await boomGET(makeRequest('GET', '/api/boom'));
        expect(response.status).toBe(503);
        const body = await response.json();
        expect(body.caught).toBe(true);
    });
});

describe('Next.js handler: alternate content types', () => {
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
    const uploadApi = new KizunaServer(uploadContract).api({
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

    const { POST: uploadPOST } = uploadApi.mount({
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

describe('Next.js handler: requestMiddleware', () => {
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

        const middlewareApi = new KizunaServer(middlewareContract).api({
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

        const { GET: middlewareGET } = middlewareApi.mount({
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

        const middlewareApi = new KizunaServer(middlewareContract).api({
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

        const { GET: middlewareGET } = middlewareApi.mount({
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

        const middlewareApi = new KizunaServer(middlewareContract).api({
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

        const { GET: middlewareGET } = middlewareApi.mount({
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

        const middlewareApi = new KizunaServer(middlewareContract).api({
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

        const { GET: middlewareGET } = middlewareApi.mount({
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

testAdapterFeatures({
    name: 'next',
    initServerApi: (contract, options) => new KizunaServer(contract).api(options),
    mount: (api, { responseValidation }) => {
        const handlers = api.mount({
            basePath: '/api',
            responseValidation,
        });
        return {
            request: async ({ method, path, body, headers }) => {
                const handler = handlers[method];
                if (!handler) throw new Error(`next: no handler exported for ${method}`);
                const response = await handler(
                    new NextRequest(`http://localhost:3000/api${path}`, {
                        method,
                        body,
                        headers,
                    })
                );
                const text = await response.text();
                return {
                    status: response.status,
                    headers: response.headers,
                    body: readTestBody(text),
                    text,
                };
            },
        };
    },
});
