import { beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createContract } from '@ts-kizuna/core';
import { createApi, fastifyKizuna, createMiddleware, type FastifyPreHandler } from './server.js';

interface User {
    id: string;
    name: string;
    email: string;
}

const contract = createContract({
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
    listUsers: {
        method: 'GET',
        path: '/users',
        query: z.object({
            page: z.coerce.number().int().min(1).default(1),
            limit: z.coerce.number().int().min(1).default(10),
        }),
        responses: {
            200: z.object({
                users: z.array(
                    z.object({
                        id: z.string(),
                        name: z.string(),
                    })
                ),
                total: z.number(),
            }),
        },
    },
    deleteUser: {
        method: 'DELETE',
        path: '/users/:id',
        responses: {
            200: z.object({
                success: z.boolean(),
            }),
            404: z.object({
                message: z.string(),
            }),
        },
    },
});

let users: Map<string, User>;
let nextId: number;
let app: FastifyInstance;

beforeEach(async () => {
    users = new Map();
    nextId = 1;
    app = Fastify();

    const api = createApi({
        contract,
        router: {
            getUser: ({ params }) => {
                const user = users.get(params.id);
                if (!user) {
                    return {
                        status: 404,
                        body: {
                            message: 'Not found',
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
                const id = String(nextId++);
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
            listUsers: ({ query }) => {
                const all = Array.from(users.values());
                const start = (query.page - 1) * query.limit;
                return {
                    status: 200,
                    body: {
                        users: all.slice(start, start + query.limit).map((user) => ({
                            id: user.id,
                            name: user.name,
                        })),
                        total: all.length,
                    },
                };
            },
            deleteUser: ({ params }) => {
                if (!users.has(params.id)) {
                    return {
                        status: 404,
                        body: {
                            message: 'Not found',
                        },
                    };
                }
                users.delete(params.id);
                return {
                    status: 200,
                    body: {
                        success: true,
                    },
                };
            },
        },
    });

    app.register(fastifyKizuna, {
        api,
    });
    await app.ready();
});

describe('Fastify integration', () => {
    it('creates a user', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/users',
            payload: {
                name: 'Alice',
                email: 'alice@test.com',
            },
        });
        expect(response.statusCode).toBe(201);
        const body = response.json();
        expect(body).toMatchObject({
            name: 'Alice',
            email: 'alice@test.com',
        });
        expect(body.id).toBeDefined();
    });

    it('gets a created user by id', async () => {
        const created = await app.inject({
            method: 'POST',
            url: '/users',
            payload: {
                name: 'Bob',
                email: 'bob@test.com',
            },
        });
        const createdBody = created.json();

        const response = await app.inject({
            method: 'GET',
            url: `/users/${createdBody.id}`,
        });
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.name).toBe('Bob');
    });

    it('returns 404 for a missing user', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/users/missing',
        });
        expect(response.statusCode).toBe(404);
        const body = response.json();
        expect(body.message).toBe('Not found');
    });

    it('lists users with query params', async () => {
        await app.inject({
            method: 'POST',
            url: '/users',
            payload: {
                name: 'Alice',
                email: 'alice@test.com',
            },
        });

        const response = await app.inject({
            method: 'GET',
            url: '/users?page=1&limit=10',
        });
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.users).toHaveLength(1);
        expect(body.total).toBe(1);
    });

    it('deletes a user', async () => {
        const created = await app.inject({
            method: 'POST',
            url: '/users',
            payload: {
                name: 'Charlie',
                email: 'charlie@test.com',
            },
        });
        const createdBody = created.json();

        const response = await app.inject({
            method: 'DELETE',
            url: `/users/${createdBody.id}`,
        });
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.success).toBe(true);

        const after = await app.inject({
            method: 'GET',
            url: `/users/${createdBody.id}`,
        });
        expect(after.statusCode).toBe(404);
    });

    it('returns 400 for invalid body', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/users',
            payload: {
                name: '',
                email: 'not-email',
            },
        });
        expect(response.statusCode).toBe(400);
        const body = response.json();
        expect(body.detail).toBe('Invalid request body');
        expect(Array.isArray(body.errors)).toBe(true);
    });
});

describe('Fastify — method mismatch', () => {
    it('returns 404 for an unregistered method because Fastify never matches the route', async () => {
        const response = await app.inject({
            method: 'PUT',
            url: '/users/123',
            payload: {
                name: 'x',
            },
        });
        expect(response.statusCode).toBe(404);
    });
});

describe('Fastify — content type', () => {
    it('returns 415 when Content-Type does not match route expectation', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/users',
            payload: '<user><name>Bob</name></user>',
            headers: {
                'content-type': 'application/xml',
            },
        });
        expect(response.statusCode).toBe(415);
    });
});

describe('Fastify — Accept header / 406', () => {
    it('returns 406 when Accept excludes application/json', async () => {
        users.set('1', {
            id: '1',
            name: 'Alice',
            email: 'alice@test.com',
        });
        const response = await app.inject({
            method: 'GET',
            url: '/users/1',
            headers: {
                accept: 'text/html',
            },
        });
        expect(response.statusCode).toBe(406);
        const body = response.json();
        expect(body.detail).toBe('Not Acceptable');
    });

    it('returns 200 when Accept is */*', async () => {
        users.set('1', {
            id: '1',
            name: 'Alice',
            email: 'alice@test.com',
        });
        const response = await app.inject({
            method: 'GET',
            url: '/users/1',
            headers: {
                accept: '*/*',
            },
        });
        expect(response.statusCode).not.toBe(406);
    });

    it('returns 200 when Accept includes application/json', async () => {
        users.set('1', {
            id: '1',
            name: 'Alice',
            email: 'alice@test.com',
        });
        const response = await app.inject({
            method: 'GET',
            url: '/users/1',
            headers: {
                accept: 'text/html, application/json',
            },
        });
        expect(response.statusCode).not.toBe(406);
    });

    it('returns 200 when Accept is absent', async () => {
        users.set('1', {
            id: '1',
            name: 'Alice',
            email: 'alice@test.com',
        });
        const response = await app.inject({
            method: 'GET',
            url: '/users/1',
        });
        expect(response.statusCode).not.toBe(406);
    });
});

describe('Fastify — responseValidation', () => {
    it('returns 500 when responseValidation is enabled and the handler returns a mismatched body', async () => {
        const strictApp = Fastify();
        const strictApi = createApi({
            contract: createContract({
                getItem: {
                    method: 'GET',
                    path: '/items/:id',
                    responses: {
                        200: z.object({
                            id: z.string(),
                        }),
                    },
                },
            }),
            router: {
                getItem: () => ({ status: 200, body: { id: 123 } }) as any,
            },
        });
        strictApp.register(fastifyKizuna, {
            api: strictApi,
            responseValidation: true,
        });
        await strictApp.ready();

        const response = await strictApp.inject({
            method: 'GET',
            url: '/items/1',
        });
        expect(response.statusCode).toBe(500);
    });
});

describe('Fastify — handler context', () => {
    it('provides the Fastify request and reply objects', async () => {
        const contextApp = Fastify();
        const contextApi = createApi({
            contract: createContract({
                echo: {
                    method: 'GET',
                    path: '/echo',
                    responses: {
                        200: z.object({
                            url: z.string(),
                        }),
                    },
                },
            }),
            router: {
                echo: ({ request }) => ({
                    status: 200,
                    body: {
                        url: request.url,
                    },
                }),
            },
        });
        contextApp.register(fastifyKizuna, {
            api: contextApi,
        });
        await contextApp.ready();

        const response = await contextApp.inject({
            method: 'GET',
            url: '/echo',
        });
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.url).toContain('/echo');
    });
});

describe('Fastify — middleware', () => {
    const middlewareContract = createContract({
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
        admin: createContract({
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
        }),
    });

    const requireAuth: FastifyPreHandler = async (request, reply) => {
        const token = request.headers.authorization;
        if (!token || token !== 'Bearer valid') {
            reply.status(401).send({
                error: 'Unauthorized',
            });
        }
    };

    const createTestRouter = () => ({
        publicRoute: () => ({
            status: 200 as const,
            body: {
                message: 'public',
            },
        }),
        protectedRoute: () => ({
            status: 200 as const,
            body: {
                message: 'protected',
            },
        }),
        admin: {
            dashboard: () => ({
                status: 200 as const,
                body: {
                    message: 'dashboard',
                },
            }),
            settings: () => ({
                status: 200 as const,
                body: {
                    message: 'settings',
                },
            }),
        },
    });

    it('applies middleware to a specific route', async () => {
        const testApp = Fastify();
        const middleware = createMiddleware(middlewareContract, {
            publicRoute: [],
            protectedRoute: [requireAuth],
            admin: [],
        });
        const api = createApi({
            contract: middlewareContract,
            router: createTestRouter(),
            middleware,
        });
        testApp.register(fastifyKizuna, {
            api,
        });
        await testApp.ready();

        const publicResponse = await testApp.inject({
            method: 'GET',
            url: '/public',
        });
        expect(publicResponse.statusCode).toBe(200);

        const protectedNoAuth = await testApp.inject({
            method: 'GET',
            url: '/protected',
        });
        expect(protectedNoAuth.statusCode).toBe(401);

        const protectedWithAuth = await testApp.inject({
            method: 'GET',
            url: '/protected',
            headers: {
                authorization: 'Bearer valid',
            },
        });
        expect(protectedWithAuth.statusCode).toBe(200);
        const body = protectedWithAuth.json();
        expect(body.message).toBe('protected');
    });

    it('applies group-level middleware to all routes in a group', async () => {
        const testApp = Fastify();
        const middleware = createMiddleware(middlewareContract, {
            publicRoute: [],
            protectedRoute: [],
            admin: [requireAuth],
        });
        const api = createApi({
            contract: middlewareContract,
            router: createTestRouter(),
            middleware,
        });
        testApp.register(fastifyKizuna, {
            api,
        });
        await testApp.ready();

        const dashboardNoAuth = await testApp.inject({
            method: 'GET',
            url: '/admin/dashboard',
        });
        expect(dashboardNoAuth.statusCode).toBe(401);

        const settingsNoAuth = await testApp.inject({
            method: 'GET',
            url: '/admin/settings',
        });
        expect(settingsNoAuth.statusCode).toBe(401);

        const dashboardWithAuth = await testApp.inject({
            method: 'GET',
            url: '/admin/dashboard',
            headers: {
                authorization: 'Bearer valid',
            },
        });
        expect(dashboardWithAuth.statusCode).toBe(200);

        const publicResponse = await testApp.inject({
            method: 'GET',
            url: '/public',
        });
        expect(publicResponse.statusCode).toBe(200);
    });
});
