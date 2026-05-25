import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Config, PayloadRequest } from 'payload';
import { createContract } from '@ts-kizuna/core';
import { createApi, createGuard, createMiddleware, kizunaPlugin } from './server.js';

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

function createMockPayloadRequest(options: {
    method: string;
    url: string;
    body?: unknown;
    headers?: Record<string, string>;
    routeParams?: Record<string, unknown>;
    user?: unknown;
    query?: Record<string, unknown>;
}): PayloadRequest {
    const url = new URL(options.url, 'http://localhost');
    const requestHeaders = new Headers(options.headers);

    const request = new Request(url.toString(), {
        method: options.method,
        headers: requestHeaders,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    return Object.assign(request, {
        payload: {} as PayloadRequest['payload'],
        user: (options.user ?? null) as PayloadRequest['user'],
        routeParams: options.routeParams as Record<string, unknown>,
        query: options.query ?? Object.fromEntries(url.searchParams),
        i18n: {} as PayloadRequest['i18n'],
        t: ((key: string) => key) as PayloadRequest['t'],
        payloadAPI: 'REST' as const,
        payloadDataLoader: {} as PayloadRequest['payloadDataLoader'],
        context: {},
    }) as unknown as PayloadRequest;
}

let users: Map<string, User>;
let nextId: number;
let endpoints: Config['endpoints'];

function findEndpoint(path: string, method: string) {
    return endpoints!.find((endpoint) => endpoint.path === path && endpoint.method === method)!;
}

beforeEach(() => {
    users = new Map();
    nextId = 1;

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

    const plugin = kizunaPlugin(api);
    const config = plugin({} as Config);
    endpoints = config.endpoints;
});

describe('Payload integration', () => {
    it('creates a user', async () => {
        const endpoint = findEndpoint('/users', 'post');
        const req = createMockPayloadRequest({
            method: 'POST',
            url: 'http://localhost/api/users',
            body: {
                name: 'Alice',
                email: 'alice@test.com',
            },
            headers: {
                'content-type': 'application/json',
            },
        });

        const response = await endpoint.handler(req);
        expect(response.status).toBe(201);
        const body = await response.json();
        expect(body).toMatchObject({
            name: 'Alice',
            email: 'alice@test.com',
        });
        expect(body.id).toBeDefined();
    });

    it('gets a created user by id', async () => {
        users.set('1', {
            id: '1',
            name: 'Bob',
            email: 'bob@test.com',
        });

        const endpoint = findEndpoint('/users/:id', 'get');
        const req = createMockPayloadRequest({
            method: 'GET',
            url: 'http://localhost/api/users/1',
            routeParams: {
                id: '1',
            },
        });

        const response = await endpoint.handler(req);
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.name).toBe('Bob');
    });

    it('returns 404 for a missing user', async () => {
        const endpoint = findEndpoint('/users/:id', 'get');
        const req = createMockPayloadRequest({
            method: 'GET',
            url: 'http://localhost/api/users/missing',
            routeParams: {
                id: 'missing',
            },
        });

        const response = await endpoint.handler(req);
        expect(response.status).toBe(404);
        const body = await response.json();
        expect(body.message).toBe('Not found');
    });

    it('lists users with query params', async () => {
        users.set('1', {
            id: '1',
            name: 'Alice',
            email: 'alice@test.com',
        });

        const endpoint = findEndpoint('/users', 'get');
        const req = createMockPayloadRequest({
            method: 'GET',
            url: 'http://localhost/api/users?page=1&limit=10',
            query: {
                page: '1',
                limit: '10',
            },
        });

        const response = await endpoint.handler(req);
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.users).toHaveLength(1);
        expect(body.total).toBe(1);
    });

    it('deletes a user', async () => {
        users.set('1', {
            id: '1',
            name: 'Charlie',
            email: 'charlie@test.com',
        });

        const endpoint = findEndpoint('/users/:id', 'delete');
        const req = createMockPayloadRequest({
            method: 'DELETE',
            url: 'http://localhost/api/users/1',
            routeParams: {
                id: '1',
            },
        });

        const response = await endpoint.handler(req);
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);

        expect(users.has('1')).toBe(false);
    });

    it('returns 400 for invalid body', async () => {
        const endpoint = findEndpoint('/users', 'post');
        const req = createMockPayloadRequest({
            method: 'POST',
            url: 'http://localhost/api/users',
            body: {
                name: '',
                email: 'not-email',
            },
            headers: {
                'content-type': 'application/json',
            },
        });

        const response = await endpoint.handler(req);
        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.message).toBe('Invalid request body');
        expect(Array.isArray(body.issues)).toBe(true);
    });
});

describe('Payload — content type', () => {
    it('returns 415 when Content-Type does not match route expectation', async () => {
        const endpoint = findEndpoint('/users', 'post');
        const req = createMockPayloadRequest({
            method: 'POST',
            url: 'http://localhost/api/users',
            body: '<user><name>Bob</name></user>',
            headers: {
                'content-type': 'application/xml',
            },
        });

        const response = await endpoint.handler(req);
        expect(response.status).toBe(415);
        const body = await response.json();
        expect(body.message).toContain('Unsupported Media Type');
    });
});

describe('Payload — Accept header / 406', () => {
    it('returns 406 when Accept excludes application/json', async () => {
        users.set('1', {
            id: '1',
            name: 'Alice',
            email: 'alice@test.com',
        });
        const endpoint = findEndpoint('/users/:id', 'get');
        const req = createMockPayloadRequest({
            method: 'GET',
            url: 'http://localhost/api/users/1',
            routeParams: {
                id: '1',
            },
            headers: {
                accept: 'text/html',
            },
        });

        const response = await endpoint.handler(req);
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
        const endpoint = findEndpoint('/users/:id', 'get');
        const req = createMockPayloadRequest({
            method: 'GET',
            url: 'http://localhost/api/users/1',
            routeParams: {
                id: '1',
            },
            headers: {
                accept: '*/*',
            },
        });

        const response = await endpoint.handler(req);
        expect(response.status).not.toBe(406);
    });
});

describe('Payload — handler context', () => {
    it('provides PayloadRequest as req in handler context', async () => {
        const mockPayload = {
            testMarker: true,
        };

        const contextApi = createApi({
            contract: createContract({
                echo: {
                    method: 'GET',
                    path: '/echo',
                    responses: {
                        200: z.object({
                            hasPayload: z.boolean(),
                            hasUser: z.boolean(),
                        }),
                    },
                },
            }),
            router: {
                echo: ({ req }) => ({
                    status: 200,
                    body: {
                        hasPayload: 'testMarker' in req.payload,
                        hasUser: req.user !== null,
                    },
                }),
            },
        });

        const plugin = kizunaPlugin(contextApi);
        const config = plugin({} as Config);
        const endpoint = config.endpoints!.find((endpoint) => endpoint.path === '/echo')!;

        const req = createMockPayloadRequest({
            method: 'GET',
            url: 'http://localhost/api/echo',
            user: {
                id: '1',
                email: 'test@test.com',
            },
        });
        (req as unknown as Record<string, unknown>).payload = mockPayload;

        const response = await endpoint.handler(req);
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.hasPayload).toBe(true);
        expect(body.hasUser).toBe(true);
    });
});

describe('Payload — responseValidation', () => {
    it('returns 500 when responseValidation is enabled and the handler returns a mismatched body', async () => {
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

        const plugin = kizunaPlugin(strictApi, {
            responseValidation: true,
        });
        const config = plugin({} as Config);
        const endpoint = config.endpoints!.find((endpoint) => endpoint.path === '/items/:id')!;

        const req = createMockPayloadRequest({
            method: 'GET',
            url: 'http://localhost/api/items/1',
            routeParams: {
                id: '1',
            },
        });

        const response = await endpoint.handler(req);
        expect(response.status).toBe(500);
    });
});

describe('Payload — middleware', () => {
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

    const requireAuth = createGuard(async (req, deny) => {
        if (!req.user) {
            return deny(401, 'Unauthorized');
        }
    });

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
        const plugin = kizunaPlugin(api);
        const config = plugin({} as Config);

        const publicEndpoint = config.endpoints!.find((endpoint) => endpoint.path === '/public')!;
        const protectedEndpoint = config.endpoints!.find((endpoint) => endpoint.path === '/protected')!;

        const publicReq = createMockPayloadRequest({
            method: 'GET',
            url: 'http://localhost/api/public',
        });
        const publicResponse = await publicEndpoint.handler(publicReq);
        expect(publicResponse.status).toBe(200);

        const protectedNoAuth = createMockPayloadRequest({
            method: 'GET',
            url: 'http://localhost/api/protected',
        });
        const protectedNoAuthResponse = await protectedEndpoint.handler(protectedNoAuth);
        expect(protectedNoAuthResponse.status).toBe(401);

        const protectedWithAuth = createMockPayloadRequest({
            method: 'GET',
            url: 'http://localhost/api/protected',
            user: {
                id: '1',
                email: 'test@test.com',
            },
        });
        const protectedWithAuthResponse = await protectedEndpoint.handler(protectedWithAuth);
        expect(protectedWithAuthResponse.status).toBe(200);
        const body = await protectedWithAuthResponse.json();
        expect(body.message).toBe('protected');
    });

    it('applies group-level middleware to all routes in a group', async () => {
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
        const plugin = kizunaPlugin(api);
        const config = plugin({} as Config);

        const dashboardEndpoint = config.endpoints!.find((endpoint) => endpoint.path === '/admin/dashboard')!;
        const settingsEndpoint = config.endpoints!.find((endpoint) => endpoint.path === '/admin/settings')!;
        const publicEndpoint = config.endpoints!.find((endpoint) => endpoint.path === '/public')!;

        const noAuth = createMockPayloadRequest({
            method: 'GET',
            url: 'http://localhost/api/admin/dashboard',
        });
        const dashboardResponse = await dashboardEndpoint.handler(noAuth);
        expect(dashboardResponse.status).toBe(401);

        const settingsNoAuth = createMockPayloadRequest({
            method: 'GET',
            url: 'http://localhost/api/admin/settings',
        });
        const settingsResponse = await settingsEndpoint.handler(settingsNoAuth);
        expect(settingsResponse.status).toBe(401);

        const publicReq = createMockPayloadRequest({
            method: 'GET',
            url: 'http://localhost/api/public',
        });
        const publicResponse = await publicEndpoint.handler(publicReq);
        expect(publicResponse.status).toBe(200);
    });
});

describe('Payload — kizunaPlugin config merging', () => {
    it('preserves existing endpoints in the config', () => {
        const api = createApi({
            contract: createContract({
                health: {
                    method: 'GET',
                    path: '/health',
                    responses: {
                        200: z.object({
                            ok: z.boolean(),
                        }),
                    },
                },
            }),
            router: {
                health: () => ({
                    status: 200,
                    body: {
                        ok: true,
                    },
                }),
            },
        });

        const existingEndpoint = {
            path: '/existing',
            method: 'get' as const,
            handler: async () => Response.json({ existing: true }),
        };

        const plugin = kizunaPlugin(api);
        const config = plugin({
            endpoints: [existingEndpoint],
        } as unknown as Config);

        expect(config.endpoints).toHaveLength(2);
        expect(config.endpoints!.find((endpoint) => endpoint.path === '/existing')).toBeDefined();
        expect(config.endpoints!.find((endpoint) => endpoint.path === '/health')).toBeDefined();
    });

    it('prefixes endpoint paths with basePath', () => {
        const api = createApi({
            contract: createContract({
                health: {
                    method: 'GET',
                    path: '/health',
                    responses: {
                        200: z.object({
                            ok: z.boolean(),
                        }),
                    },
                },
            }),
            router: {
                health: () => ({
                    status: 200,
                    body: {
                        ok: true,
                    },
                }),
            },
        });

        const plugin = kizunaPlugin(api, {
            basePath: '/kizuna',
        });
        const config = plugin({} as Config);

        expect(config.endpoints).toHaveLength(1);
        expect(config.endpoints![0]!.path).toBe('/kizuna/health');
    });
});
