import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import { z } from 'zod';
import type { Server, AddressInfo } from 'node:net';
import { Kizuna } from '@ts-kizuna/core';
import { ProblemDetailsSchema } from '@ts-kizuna/core/schemas';
import { KizunaClient, type Client } from '@ts-kizuna/fetch';
import { KizunaServer } from '@ts-kizuna/express';

const k = new Kizuna({
    groups: Kizuna.groups({
        api: 'API',
    }),
});

const contractRoutes = k.routes.api({
    createUser: {
        method: 'POST',
        path: '/users',
        body: z.object({
            name: z.string(),
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
    getUser: {
        method: 'GET',
        path: '/users/:id',
        responses: {
            200: z.object({
                id: z.string(),
                name: z.string(),
                email: z.string(),
            }),
            404: ProblemDetailsSchema,
        },
    },
});

const contract = k.contract({
    routes: contractRoutes,
});

describe('end-to-end: typed client → Express server', () => {
    let server: Server;
    let client: Client<typeof contract.routes>;
    const users = new Map<string, { id: string; name: string; email: string }>();

    beforeAll(async () => {
        const app = express();
        app.use(express.json());

        const api = new KizunaServer(contract).api({
            router: {
                createUser: ({ body }) => {
                    const id = String(users.size + 1);
                    const user = {
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
                        body: user,
                    };
                },
            },
        });

        api.mount(app);

        await new Promise<void>((resolve) => {
            server = app.listen(0, () => resolve());
        });

        const address = server.address() as AddressInfo;
        client = new KizunaClient(contract, {
            baseUrl: `http://localhost:${address.port}`,
        });
    });

    afterAll(() => {
        server?.close();
    });

    it('creates and fetches a user with full type safety', async () => {
        const created = await client.createUser({
            body: {
                name: 'Alice',
                email: 'alice@test.com',
            },
        });
        expect(created.status).toBe(201);
        if (created.status !== 201) throw new Error('expected 201');

        expect(created.body.name).toBe('Alice');
        expect(created.body.email).toBe('alice@test.com');
        expect(created.body.id).toBeDefined();

        const fetched = await client.getUser({
            params: {
                id: created.body.id,
            },
        });
        expect(fetched.status).toBe(200);
        if (fetched.status === 200) {
            expect(fetched.body.name).toBe('Alice');
        }
    });

    it('returns typed 404 for a missing user', async () => {
        const result = await client.getUser({
            params: {
                id: 'nonexistent',
            },
        });
        expect(result.status).toBe(404);
        if (result.status === 404) {
            expect(result.body.detail).toBe('Not found');
        }
    });
});

const contractWithResponseHeadersRoutes = k.routes.api({
    getUser: {
        method: 'GET',
        path: '/users/:id',
        responses: {
            200: {
                body: z.object({
                    id: z.string(),
                    name: z.string(),
                }),
                headers: z.object({
                    'x-request-id': z.string().optional(),
                }),
            },
            404: ProblemDetailsSchema,
        },
    },
});

const contractWithResponseHeaders = k.contract({
    routes: contractWithResponseHeadersRoutes,
});

describe('end-to-end: response headers', () => {
    let server: Server;
    let client: Client<typeof contractWithResponseHeaders.routes>;

    beforeAll(async () => {
        const app = express();
        app.use(express.json());

        const api = new KizunaServer(contractWithResponseHeaders).api({
            router: {
                getUser: ({ params, headers, res }) => {
                    const requestId = headers['x-request-id'];
                    if (requestId) res.setHeader('x-request-id', requestId);
                    return {
                        status: 200,
                        body: {
                            id: params.id,
                            name: 'Alice',
                        },
                    };
                },
            },
        });

        api.mount(app);

        await new Promise<void>((resolve) => {
            server = app.listen(0, () => resolve());
        });

        const address = server.address() as AddressInfo;
        client = new KizunaClient(contractWithResponseHeaders, {
            baseUrl: `http://localhost:${address.port}`,
        });
    });

    afterAll(() => {
        server?.close();
    });

    it('client exposes response headers echoed by the server', async () => {
        const result = await client.getUser({
            params: {
                id: '1',
            },
            headers: {
                'x-request-id': 'trace-e2e-999',
            },
        });
        expect(result.status).toBe(200);
        expect(result.headers['x-request-id']).toBe('trace-e2e-999');
    });
});

const userIdentity = Kizuna.identity.bearer({
    context: z.object({
        userId: z.string(),
    }),
});

const securedK = new Kizuna({
    identities: {
        user: userIdentity,
    },
});

const securedRoutes = securedK.routes({
    whoAmI: {
        method: 'GET',
        path: '/who-am-i',
        responses: {
            200: z.object({
                userId: z.string(),
            }),
            401: ProblemDetailsSchema,
        },
    },
});

const securedContract = securedK.contract({
    routes: {
        api: securedRoutes,
    },
    auth: {
        api: 'user',
    },
});

describe('end-to-end: typed client → secured Express route', () => {
    let server: Server;
    let baseUrl: string;

    beforeAll(async () => {
        const app = express();
        app.use(express.json());

        const securedServer = new KizunaServer(securedContract);

        const requireUser = securedServer.guard('user', ({ bearer, deny }) => {
            if (bearer?.token !== 'tok_ada') return deny(401, 'Unauthorized');
            return {
                userId: '1',
            };
        });

        const api = securedServer.api({
            router: {
                api: {
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

        api.mount(app);

        await new Promise<void>((resolve) => {
            server = app.listen(0, () => resolve());
        });
        const address = server.address() as AddressInfo;
        baseUrl = `http://localhost:${address.port}`;
    });

    afterAll(() => {
        server?.close();
    });

    it('round-trips with the credential in baseHeaders', async () => {
        const client = new KizunaClient(securedContract, {
            baseUrl,
            baseHeaders: {
                authorization: 'Bearer tok_ada',
            },
        });
        const response = await client.api.whoAmI();
        expect(response.status).toBe(200);
        if (response.status === 200) {
            expect(response.body.userId).toBe('1');
        }
    });

    it('surfaces the typed 401 without a credential', async () => {
        const client = new KizunaClient(securedContract, {
            baseUrl,
        });
        const response = await client.api.whoAmI();
        expect(response.status).toBe(401);
        if (response.status === 401) {
            expect(response.body.detail).toBe('Unauthorized');
        }
    });
});
