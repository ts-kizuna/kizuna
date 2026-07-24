import { describe, expect, it } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { kizuna, createTags, createIdentity } from '@ts-kizuna/core';
import { ProblemDetailsSchema } from '@ts-kizuna/core/schemas';
import { createApi, createExpressEndpoints, createGuard, createMiddleware, createRouter, createServer } from './server.js';

const { k } = kizuna({
    tags: createTags({
        api: 'API',
    }),
});

interface User {
    id: string;
    name: string;
    email: string;
}

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
    listUsers: {
        method: 'GET',
        path: '/users',
        query: z.object({
            page: z.number().int().min(1).default(1),
            limit: z.number().int().min(1).default(10),
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
            404: ProblemDetailsSchema,
        },
    },
});

const contract = k.contract({
    routes: contractRoutes,
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
                            detail: 'Not found',
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
        expect(response.body.detail).toBeDefined();
    });
});

describe('Express integration — all HTTP methods', () => {
    const allMethodsContractRoutes = k.routes('api', {
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

    const allMethodsContract = k.contract({
        routes: allMethodsContractRoutes,
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
    const validationContractRoutes = k.routes('api', {
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

    const validationContract = k.contract({
        routes: validationContractRoutes,
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
        expect(response.body.detail).toBeDefined();
        expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('returns application/problem+json content type for validation errors', async () => {
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
        expect(response.headers['content-type']).toContain('application/problem+json');
    });
});

describe('declared response contentType', () => {
    const csvContractRoutes = k.routes('api', {
        exportItems: {
            method: 'GET',
            path: '/items.csv',
            responses: {
                200: {
                    body: z.string(),
                    contentType: 'text/csv',
                },
            },
        },
    });

    const csvContract = k.contract({
        routes: csvContractRoutes,
    });

    it('sends a non-JSON body raw with the declared content type', async () => {
        const app = express();
        const api = createApi({
            contract: csvContract,
            router: {
                exportItems: () => ({
                    status: 200,
                    body: 'id,name\n1,Ada',
                }),
            },
        });
        createExpressEndpoints(api, app);

        const response = await request(app).get('/items.csv');
        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toContain('text/csv');
        // Raw — not JSON-quoted/escaped.
        expect(response.text).toBe('id,name\n1,Ada');
    });

    it('sends a binary body as raw bytes', async () => {
        const binaryContractRoutes = k.routes('api', {
            downloadBadge: {
                method: 'GET',
                path: '/badge',
                responses: {
                    200: {
                        body: z.instanceof(Uint8Array),
                        contentType: 'application/octet-stream',
                    },
                },
            },
        });

        const binaryContract = k.contract({
            routes: binaryContractRoutes,
        });
        const app = express();
        const api = createApi({
            contract: binaryContract,
            router: {
                downloadBadge: () => ({
                    status: 200,
                    body: Buffer.from([0x25, 0x50, 0x44, 0x46]),
                }),
            },
        });
        createExpressEndpoints(api, app);

        const response = await request(app)
            .get('/badge')
            .buffer(true)
            .parse((res, callback) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(chunk as Buffer));
                res.on('end', () => callback(null, Buffer.concat(chunks)));
            });
        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toContain('application/octet-stream');
        expect(Buffer.from(response.body).equals(Buffer.from([0x25, 0x50, 0x44, 0x46]))).toBe(true);
    });
});

describe('Express integration — void / noBody responses', () => {
    const voidContractRoutes = k.routes('api', {
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

    const voidContract = k.contract({
        routes: voidContractRoutes,
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

        createExpressEndpoints(strictApi, app, {
            responseValidation: true,
        });

        const response = await request(app).get('/items/1');
        expect(response.status).toBe(500);
    });
});

describe('createRouter — accepts a contract or a bare route group', () => {
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

    it('types a sub-router from a route group and serves it composed into a contract', async () => {
        // Bare route group — no `{ routes: ... }` wrapper needed.
        const usersRouter = createRouter(usersRoutes, {
            getUser: ({ params }) => ({
                status: 200,
                body: {
                    id: params.id,
                },
            }),
        });

        // Full contract — the existing form still works.
        const router = createRouter(subContract, {
            users: usersRouter,
        });

        const app = express();
        const api = createApi({
            contract: subContract,
            router,
        });
        createExpressEndpoints(api, app);

        const response = await request(app).get('/sub-users/42');
        expect(response.status).toBe(200);
        expect(response.body.id).toBe('42');
    });
});

describe('guards', () => {
    const user = createIdentity.bearer({
        context: z.object({
            userId: z.string(),
        }),
    });

    const member = createIdentity.apiKey({
        name: 'x-workspace-token',
        in: 'header',
        context: z.object({
            workspaceUserId: z.string(),
        }),
        access: z.object({
            role: z.enum(['owner', 'admin']),
        }),
    });

    const { k: securedK } = kizuna({
        identities: {
            user,
            member,
        },
    });

    const securedRoutes = securedK.routes({
        publicRoute: {
            method: 'GET',
            path: '/public',
            responses: {
                200: z.object({
                    ok: z.boolean(),
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
        ownerOnly: {
            method: 'GET',
            path: '/owner-only',
            responses: {
                200: z.object({
                    role: z.string(),
                }),
            },
        },
        both: {
            method: 'GET',
            path: '/both',
            responses: {
                200: z.object({
                    userId: z.string(),
                    workspaceUserId: z.string(),
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
                ownerOnly: {
                    member: {
                        role: 'owner',
                    },
                },
                both: {
                    user: true,
                    member: true,
                },
            },
        },
    });

    const sessions = new Map([['tok_ada', { userId: '1' }]]);
    const memberships = new Map<string, { workspaceUserId: string; role: 'owner' | 'admin' }>([
        ['wst_owner', { workspaceUserId: '1', role: 'owner' }],
        ['wst_admin', { workspaceUserId: '2', role: 'admin' }],
    ]);

    const requireUser = createGuard(securedContract, 'user', ({ bearer, deny }) => {
        const session = bearer ? sessions.get(bearer.token) : undefined;
        if (!session) return deny(401, 'Unauthorized');
        return session;
    });

    const requireMember = createGuard(securedContract, 'member', ({ apiKey, deny }) => {
        const membership = apiKey ? memberships.get(apiKey.value) : undefined;
        if (!membership) return deny(403, 'Forbidden');
        return membership;
    });

    const makeApp = () => {
        const app = express();
        app.use(express.json());
        const api = createApi({
            contract: securedContract,
            router: {
                api: {
                    publicRoute: () => ({
                        status: 200,
                        body: {
                            ok: true,
                        },
                    }),
                    whoAmI: ({ auth }) => ({
                        status: 200,
                        body: {
                            userId: auth.user.userId,
                        },
                    }),
                    ownerOnly: ({ auth }) => ({
                        status: 200,
                        body: {
                            role: auth.member.role,
                        },
                    }),
                    both: ({ auth }) => ({
                        status: 200,
                        body: {
                            userId: auth.user.userId,
                            workspaceUserId: auth.member.workspaceUserId,
                        },
                    }),
                },
            },
            guards: {
                user: requireUser,
                member: requireMember,
            },
        });
        createExpressEndpoints(api, app);
        return app;
    };

    it('serves a public route without credentials', async () => {
        const response = await request(makeApp()).get('/public');
        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            ok: true,
        });
    });

    it('denies a secured route without a credential as problem details', async () => {
        const response = await request(makeApp()).get('/who-am-i');
        expect(response.status).toBe(401);
        expect(response.headers['content-type']).toContain('application/problem+json');
        expect(response.body.detail).toBe('Unauthorized');
    });

    it('passes the guard context to the handler', async () => {
        const response = await request(makeApp()).get('/who-am-i').set('authorization', 'Bearer tok_ada');
        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            userId: '1',
        });
    });

    it('rejects a gated route when the access field is not permitted', async () => {
        const response = await request(makeApp()).get('/owner-only').set('x-workspace-token', 'wst_admin');
        expect(response.status).toBe(403);
    });

    it('allows a gated route when the access field is permitted', async () => {
        const response = await request(makeApp()).get('/owner-only').set('x-workspace-token', 'wst_owner');
        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            role: 'owner',
        });
    });

    it('requires every identity on a multi-identity route', async () => {
        const missingMember = await request(makeApp()).get('/both').set('authorization', 'Bearer tok_ada');
        expect(missingMember.status).toBe(403);

        const complete = await request(makeApp()).get('/both').set('authorization', 'Bearer tok_ada').set('x-workspace-token', 'wst_owner');
        expect(complete.status).toBe(200);
        expect(complete.body).toEqual({
            userId: '1',
            workspaceUserId: '1',
        });
    });
});
describe('Express integration — middleware map', () => {
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

    const requireAuth = (req: Request, res: Response, next: NextFunction) => {
        const token = req.headers.authorization;
        if (!token || token !== 'Bearer valid') {
            res.status(401).json({
                error: 'Unauthorized',
            });
            return;
        }
        next();
    };

    it('applies middleware to a specific route', async () => {
        const app = express();
        const middleware = createMiddleware(middlewareContract, {
            publicRoute: [],
            protectedRoute: [requireAuth],
            admin: [],
        });
        const api = createApi({
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
        createExpressEndpoints(api, app);

        const publicResponse = await request(app).get('/public');
        expect(publicResponse.status).toBe(200);

        const protectedNoAuth = await request(app).get('/protected');
        expect(protectedNoAuth.status).toBe(401);

        const protectedWithAuth = await request(app).get('/protected').set('authorization', 'Bearer valid');
        expect(protectedWithAuth.status).toBe(200);
        expect(protectedWithAuth.body.message).toBe('protected');
    });

    it('applies group-level middleware to all routes in a group', async () => {
        const app = express();
        const middleware = createMiddleware(middlewareContract, {
            publicRoute: [],
            protectedRoute: [],
            admin: [requireAuth],
        });
        const api = createApi({
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
        createExpressEndpoints(api, app);

        const dashboardNoAuth = await request(app).get('/admin/dashboard');
        expect(dashboardNoAuth.status).toBe(401);

        const settingsNoAuth = await request(app).get('/admin/settings');
        expect(settingsNoAuth.status).toBe(401);

        const dashboardWithAuth = await request(app).get('/admin/dashboard').set('authorization', 'Bearer valid');
        expect(dashboardWithAuth.status).toBe(200);

        const publicResponse = await request(app).get('/public');
        expect(publicResponse.status).toBe(200);
    });
});

describe('createServer', () => {
    const { k: serverK } = kizuna({
        identities: {
            user: createIdentity.bearer({
                context: z.object({
                    userId: z.string(),
                }),
            }),
        },
    });

    const serverRoutes = serverK.routes({
        getMe: {
            method: 'GET',
            path: '/me',
            responses: {
                200: z.object({
                    userId: z.string(),
                }),
                401: ProblemDetailsSchema,
            },
        },
        ping: {
            method: 'GET',
            path: '/ping',
            responses: {
                200: z.object({
                    ok: z.boolean(),
                }),
            },
        },
    });

    const serverContract = serverK.contract({
        routes: {
            main: serverRoutes,
        },
        auth: {
            main: {
                '*': false,
                getMe: 'user',
            },
        },
    });

    const { server } = createServer(serverContract);

    const requireUser = server.guard('user', ({ bearer, deny }) => {
        if (bearer?.token !== 'secret') {
            return deny(401, 'Unauthorized');
        }
        return {
            userId: 'u1',
        };
    });

    const router = server.router({
        main: {
            getMe: ({ auth }) => ({
                status: 200,
                body: {
                    userId: auth.user.userId,
                },
            }),
            ping: () => ({
                status: 200,
                body: {
                    ok: true,
                },
            }),
        },
    });

    const api = server.api({
        router,
        guards: {
            user: requireUser,
        },
    });

    const build = () => {
        const app = express();
        app.use(express.json());
        createExpressEndpoints(api, app);
        return app;
    };

    it('serves a public route', async () => {
        const response = await request(build()).get('/ping');
        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            ok: true,
        });
    });

    it('runs the guard from server.guard and exposes its context', async () => {
        const response = await request(build()).get('/me').set('authorization', 'Bearer secret');
        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            userId: 'u1',
        });
    });

    it('denies when the guard from server.guard rejects', async () => {
        const response = await request(build()).get('/me');
        expect(response.status).toBe(401);
    });

    it('types a sub-router from a bare route group and serves it composed into the contract', async () => {
        const usersRoutes = serverK.routes('api', {
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

        const subContract = serverK.contract({
            routes: {
                users: usersRoutes,
            },
        });

        const { server: subServer } = createServer(subContract);

        const usersRouter = subServer.router(usersRoutes, {
            getUser: ({ params }) => ({
                status: 200,
                body: {
                    id: params.id,
                },
            }),
        });

        const composed = subServer.router({
            users: usersRouter,
        });

        const app = express();
        const api = subServer.api({
            router: composed,
        });
        createExpressEndpoints(api, app);

        const response = await request(app).get('/sub-users/42');
        expect(response.status).toBe(200);
        expect(response.body.id).toBe('42');
    });
});
