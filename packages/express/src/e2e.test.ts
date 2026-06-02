import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import { z } from 'zod';
import type { Server, AddressInfo } from 'node:net';
import { createContract } from '@ts-kizuna/core';
import { ProblemDetailsSchema } from '@ts-kizuna/core/schemas';
import { createClient, type Client } from '@ts-kizuna/fetch';
import { createApi, createExpressEndpoints } from './server.js';

const contract = createContract({
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

describe('end-to-end: typed client → Express server', () => {
    let server: Server;
    let client: Client<typeof contract>;
    const users = new Map<string, { id: string; name: string; email: string }>();

    beforeAll(async () => {
        const app = express();
        app.use(express.json());

        const api = createApi({
            contract,
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

        createExpressEndpoints(api, app);

        await new Promise<void>((resolve) => {
            server = app.listen(0, () => resolve());
        });

        const address = server.address() as AddressInfo;
        client = createClient(contract, {
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

const contractWithResponseHeaders = createContract({
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

describe('end-to-end: response headers', () => {
    let server: Server;
    let client: Client<typeof contractWithResponseHeaders>;

    beforeAll(async () => {
        const app = express();
        app.use(express.json());

        const api = createApi({
            contract: contractWithResponseHeaders,
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

        createExpressEndpoints(api, app);

        await new Promise<void>((resolve) => {
            server = app.listen(0, () => resolve());
        });

        const address = server.address() as AddressInfo;
        client = createClient(contractWithResponseHeaders, {
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
