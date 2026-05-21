import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { createContract } from '@ts-kizuna/core';
import { createApi, createExpressEndpoints } from './server.js';

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

const createTestApp = () => {
    const app = express();
    app.use(express.json());

    const users = new Map<string, User>();
    let nextId = 1;

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
            listUsers: () => {
                const all = Array.from(users.values()).map((user) => ({
                    id: user.id,
                    name: user.name,
                }));
                return {
                    status: 200,
                    body: {
                        users: all,
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

    createExpressEndpoints(api, app);
    return app;
};

describe('Express integration', () => {
    const app = createTestApp();

    it('creates a user', async () => {
        const response = await request(app).post('/users').send({
            name: 'Alice',
            email: 'alice@test.com',
        });
        expect(response.status).toBe(201);
        expect(response.body).toMatchObject({
            name: 'Alice',
            email: 'alice@test.com',
        });
        expect(response.body.id).toBeDefined();
    });

    it('gets a created user by id', async () => {
        const created = await request(app).post('/users').send({
            name: 'Bob',
            email: 'bob@test.com',
        });
        const response = await request(app).get(`/users/${created.body.id}`);
        expect(response.status).toBe(200);
        expect(response.body.name).toBe('Bob');
    });

    it('lists users with coerced pagination defaults', async () => {
        const response = await request(app).get('/users');
        expect(response.status).toBe(200);
        expect(Array.isArray(response.body.users)).toBe(true);
        expect(typeof response.body.total).toBe('number');
    });

    it('deletes a user and reports 404 afterwards', async () => {
        const created = await request(app).post('/users').send({
            name: 'Charlie',
            email: 'charlie@test.com',
        });
        const deleteResponse = await request(app).delete(`/users/${created.body.id}`);
        expect(deleteResponse.status).toBe(200);
        expect(deleteResponse.body.success).toBe(true);

        const getResponse = await request(app).get(`/users/${created.body.id}`);
        expect(getResponse.status).toBe(404);
    });

    it('returns 404 for an unknown user', async () => {
        const response = await request(app).get('/users/missing');
        expect(response.status).toBe(404);
        expect(response.body.message).toBeDefined();
    });
});

describe('Express integration — globalMiddleware', () => {
    const globalContract = createContract({
        getResource: {
            method: 'GET',
            path: '/resources/:id',
            responses: {
                200: z.object({
                    id: z.string(),
                }),
                401: z.object({
                    message: z.string(),
                }),
            },
        },
    });

    it('runs globalMiddleware after kizunaRoute is set and before the handler', async () => {
        const app = express();
        app.use(express.json());

        const routesSeen: string[] = [];

        const api = createApi({
            contract: globalContract,
            router: {
                getResource: ({ params }) => ({
                    status: 200,
                    body: {
                        id: params.id,
                    },
                }),
            },
        });

        createExpressEndpoints(api, app, {
            globalMiddleware: [
                (req, _res, next) => {
                    routesSeen.push(req.kizunaRoute.path);
                    next();
                },
            ],
        });

        await request(app).get('/resources/42');
        expect(routesSeen).toEqual(['/resources/:id']);
    });

    it('globalMiddleware can short-circuit the request', async () => {
        const app = express();
        app.use(express.json());

        const api = createApi({
            contract: globalContract,
            router: {
                getResource: ({ params }) => ({
                    status: 200,
                    body: {
                        id: params.id,
                    },
                }),
            },
        });

        createExpressEndpoints(api, app, {
            globalMiddleware: [
                (_req, res, _next) => {
                    res.status(401).json({
                        message: 'Unauthorized',
                    });
                },
            ],
        });

        const response = await request(app).get('/resources/1');
        expect(response.status).toBe(401);
        expect(response.body.message).toBe('Unauthorized');
    });
});

describe('Express integration — all HTTP methods', () => {
    const allMethodsContract = createContract({
        getItem: {
            method: 'GET',
            path: '/method-items/:id',
            responses: {
                200: z.object({
                    method: z.string(),
                }),
            },
        },
        headItem: {
            method: 'HEAD',
            path: '/method-items/:id',
            responses: {
                200: z.object({
                    method: z.string(),
                }),
            },
        },
        createItem: {
            method: 'POST',
            path: '/method-items',
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
            path: '/method-items/:id',
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
            path: '/method-items/:id',
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
            path: '/method-items/:id',
            responses: {
                200: z.object({
                    method: z.string(),
                }),
            },
        },
        optionsItem: {
            method: 'OPTIONS',
            path: '/method-items/:id',
            responses: {
                200: z.object({
                    method: z.string(),
                }),
            },
        },
    });

    const echoMethod = (method: string) => () => ({
        status: 200 as const,
        body: {
            method,
        },
    });

    const app = express();
    app.use(express.json());

    const api = createApi({
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

    createExpressEndpoints(api, app);

    it('GET routes correctly', async () => {
        const response = await request(app).get('/method-items/1');
        expect(response.status).toBe(200);
        expect(response.body.method).toBe('GET');
    });

    it('HEAD routes correctly and strips the response body', async () => {
        const response = await request(app).head('/method-items/1');
        expect(response.status).toBe(200);
        // HEAD responses have no body by HTTP spec; supertest does not populate text
        expect(response.body).toEqual({});
    });

    it('POST routes correctly', async () => {
        const response = await request(app).post('/method-items').send({ name: 'x' });
        expect(response.status).toBe(200);
        expect(response.body.method).toBe('POST');
    });

    it('PUT routes correctly', async () => {
        const response = await request(app).put('/method-items/1').send({ name: 'x' });
        expect(response.status).toBe(200);
        expect(response.body.method).toBe('PUT');
    });

    it('PATCH routes correctly', async () => {
        const response = await request(app).patch('/method-items/1').send({ name: 'x' });
        expect(response.status).toBe(200);
        expect(response.body.method).toBe('PATCH');
    });

    it('DELETE routes correctly', async () => {
        const response = await request(app).delete('/method-items/1');
        expect(response.status).toBe(200);
        expect(response.body.method).toBe('DELETE');
    });

    it('OPTIONS routes correctly', async () => {
        const response = await request(app).options('/method-items/1');
        expect(response.status).toBe(200);
        expect(response.body.method).toBe('OPTIONS');
    });
});

describe('Express integration — requestValidationErrorHandler', () => {
    const validationContract = createContract({
        createItem: {
            method: 'POST',
            path: '/items',
            body: z.object({
                name: z.string().min(1),
            }),
            responses: {
                201: z.object({
                    id: z.string(),
                }),
            },
        },
    });

    it('uses the default 400 shape when no handler is provided', async () => {
        const app = express();
        app.use(express.json());

        const api = createApi({
            contract: validationContract,
            router: {
                createItem: () => ({
                    status: 201,
                    body: {
                        id: '1',
                    },
                }),
            },
        });

        createExpressEndpoints(api, app);

        const response = await request(app).post('/items').send({
            name: '',
        });
        expect(response.status).toBe(400);
        expect(response.body.message).toBeDefined();
        expect(Array.isArray(response.body.issues)).toBe(true);
    });

    it('returns application/json content type for validation errors', async () => {
        const app = express();
        app.use(express.json());

        const api = createApi({
            contract: validationContract,
            router: {
                createItem: () => ({
                    status: 201,
                    body: {
                        id: '1',
                    },
                }),
            },
        });

        createExpressEndpoints(api, app);

        const response = await request(app).post('/items').send({
            name: '',
        });
        expect(response.status).toBe(400);
        expect(response.headers['content-type']).toContain('application/json');
    });
});

describe('Express integration — void / noBody responses', () => {
    const voidContract = createContract({
        deleteItem: {
            method: 'DELETE',
            path: '/items/:id',
            responses: {
                204: z.void(),
            },
        },
        sendNotification: {
            method: 'POST',
            path: '/notifications',
            body: z.object({
                message: z.string(),
            }),
            responses: {
                201: z.void(),
            },
        },
    });

    const createVoidApp = () => {
        const app = express();
        app.use(express.json());

        const api = createApi({
            contract: voidContract,
            router: {
                deleteItem: () => ({
                    status: 204 as const,
                    body: undefined,
                }),
                sendNotification: () => ({
                    status: 201 as const,
                    body: undefined,
                }),
            },
        });

        createExpressEndpoints(api, app);
        return app;
    };

    it('returns no content-type header for void responses', async () => {
        const app = createVoidApp();
        const response = await request(app).delete('/items/1');
        expect(response.status).toBe(204);
        expect(response.headers['content-type']).toBeUndefined();
    });

    it('returns an empty body for void responses', async () => {
        const app = createVoidApp();
        const response = await request(app).delete('/items/1');
        expect(response.status).toBe(204);
        expect(response.text).toBe('');
    });

    it('void response body is parseable by JSON-based clients (no JSON.parse crash)', async () => {
        const app = createVoidApp();
        const response = await request(app).post('/notifications').send({ message: 'hello' });
        expect(response.status).toBe(201);
        expect(response.headers['content-type']).toBeUndefined();
        expect(response.text).toBe('');
    });
});

describe('Express handler — responseValidation', () => {
    it('returns 500 when responseValidation is enabled and the handler returns a mismatched body', async () => {
        const app = express();
        app.use(express.json());

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

        createExpressEndpoints(strictApi, app, {
            responseValidation: true,
        });

        const response = await request(app).get('/items/1');
        expect(response.status).toBe(500);
    });
});
