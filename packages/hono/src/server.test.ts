import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import { createContract } from '@ts-kizuna/core';
import { createApi, createHonoEndpoints } from './server.js';

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
let app: Hono;

beforeEach(() => {
    users = new Map();
    nextId = 1;
    app = new Hono();

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

    createHonoEndpoints(api, app);
});

describe('Hono integration', () => {
    it('creates a user', async () => {
        const response = await app.request('/users', {
            method: 'POST',
            body: JSON.stringify({
                name: 'Alice',
                email: 'alice@test.com',
            }),
            headers: {
                'content-type': 'application/json',
            },
        });
        expect(response.status).toBe(201);
        const body = await response.json();
        expect(body).toMatchObject({
            name: 'Alice',
            email: 'alice@test.com',
        });
        expect(body.id).toBeDefined();
    });

    it('gets a created user by id', async () => {
        const created = await app.request('/users', {
            method: 'POST',
            body: JSON.stringify({
                name: 'Bob',
                email: 'bob@test.com',
            }),
            headers: {
                'content-type': 'application/json',
            },
        });
        const createdBody = await created.json();

        const response = await app.request(`/users/${createdBody.id}`);
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.name).toBe('Bob');
    });

    it('returns 404 for a missing user', async () => {
        const response = await app.request('/users/missing');
        expect(response.status).toBe(404);
        const body = await response.json();
        expect(body.message).toBe('Not found');
    });

    it('lists users with query params', async () => {
        await app.request('/users', {
            method: 'POST',
            body: JSON.stringify({
                name: 'Alice',
                email: 'alice@test.com',
            }),
            headers: {
                'content-type': 'application/json',
            },
        });

        const response = await app.request('/users?page=1&limit=10');
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.users).toHaveLength(1);
        expect(body.total).toBe(1);
    });

    it('deletes a user', async () => {
        const created = await app.request('/users', {
            method: 'POST',
            body: JSON.stringify({
                name: 'Charlie',
                email: 'charlie@test.com',
            }),
            headers: {
                'content-type': 'application/json',
            },
        });
        const createdBody = await created.json();

        const response = await app.request(`/users/${createdBody.id}`, {
            method: 'DELETE',
        });
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);

        const after = await app.request(`/users/${createdBody.id}`);
        expect(after.status).toBe(404);
    });

    it('returns 400 for invalid body', async () => {
        const response = await app.request('/users', {
            method: 'POST',
            body: JSON.stringify({
                name: '',
                email: 'not-email',
            }),
            headers: {
                'content-type': 'application/json',
            },
        });
        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.message).toBe('Invalid request body');
        expect(Array.isArray(body.issues)).toBe(true);
    });
});

describe('Hono — method mismatch', () => {
    it('returns 404 for an unregistered method because Hono never matches the route', async () => {
        const response = await app.request('/users/123', {
            method: 'PUT',
            body: JSON.stringify({
                name: 'x',
            }),
            headers: {
                'content-type': 'application/json',
            },
        });
        expect(response.status).toBe(404);
    });
});

describe('Hono — content type', () => {
    it('returns 415 when Content-Type does not match route expectation', async () => {
        const response = await app.request('/users', {
            method: 'POST',
            body: '<user><name>Bob</name></user>',
            headers: {
                'content-type': 'application/xml',
            },
        });
        expect(response.status).toBe(415);
        const body = await response.json();
        expect(body.message).toContain('Unsupported Media Type');
    });
});

describe('Hono — Accept header / 406', () => {
    it('returns 406 when Accept excludes application/json', async () => {
        users.set('1', {
            id: '1',
            name: 'Alice',
            email: 'alice@test.com',
        });
        const response = await app.request('/users/1', {
            headers: {
                accept: 'text/html',
            },
        });
        expect(response.status).toBe(406);
        const body = await response.json();
        expect(body.message).toBe('Not Acceptable');
    });

    it('returns 200 when Accept is */*', async () => {
        users.set('1', {
            id: '1',
            name: 'Alice',
            email: 'alice@test.com',
        });
        const response = await app.request('/users/1', {
            headers: {
                accept: '*/*',
            },
        });
        expect(response.status).not.toBe(406);
    });

    it('returns 200 when Accept includes application/json', async () => {
        users.set('1', {
            id: '1',
            name: 'Alice',
            email: 'alice@test.com',
        });
        const response = await app.request('/users/1', {
            headers: {
                accept: 'text/html, application/json',
            },
        });
        expect(response.status).not.toBe(406);
    });

    it('returns 200 when Accept is absent', async () => {
        users.set('1', {
            id: '1',
            name: 'Alice',
            email: 'alice@test.com',
        });
        const response = await app.request('/users/1');
        expect(response.status).not.toBe(406);
    });
});

describe('Hono — responseValidation', () => {
    it('returns 500 when responseValidation is enabled and the handler returns a mismatched body', async () => {
        const strictApp = new Hono();
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
        createHonoEndpoints(strictApi, strictApp, {
            responseValidation: true,
        });

        const response = await strictApp.request('/items/1');
        expect(response.status).toBe(500);
    });
});

describe('Hono — handler context', () => {
    it('provides the Hono Context object as c', async () => {
        const contextApp = new Hono();
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
                echo: ({ c }) => ({
                    status: 200,
                    body: {
                        url: c.req.url,
                    },
                }),
            },
        });
        createHonoEndpoints(contextApi, contextApp);

        const response = await contextApp.request('/echo');
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.url).toContain('/echo');
    });
});
