import { describe, expect, it, afterEach } from 'vitest';
import { z } from 'zod';
import Fastify, { type FastifyInstance } from 'fastify';
import { Kizuna } from '@ts-kizuna/core';
import { assembleApi } from '@ts-kizuna/core/adapter';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { fastifyKizunaMcp } from './fastify.js';

const { k } = Kizuna.init({
    tags: Kizuna.tags({
        api: 'API',
    }),
});

const contractRoutes = k.routes('api', {
    users: {
        listUsers: {
            method: 'GET',
            path: '/users',
            summary: 'List users',
            query: z.object({
                page: z.number().optional(),
            }),
            responses: {
                200: z.object({
                    users: z.array(
                        z.object({
                            id: z.string(),
                            name: z.string(),
                        })
                    ),
                }),
            },
        },
        getUser: {
            method: 'GET',
            path: '/users/:id',
            summary: 'Get a user by id',
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
            summary: 'Create a user',
            body: z.object({
                name: z.string(),
                email: z.string(),
            }),
            responses: {
                201: z.object({
                    id: z.string(),
                    name: z.string(),
                    email: z.string(),
                }),
            },
        },
    },
    health: {
        method: 'GET',
        path: '/health',
        responses: {
            200: z.object({
                ok: z.boolean(),
            }),
        },
    },
});

const contract = k.contract({
    routes: contractRoutes,
});

const router = {
    users: {
        listUsers: () => ({
            status: 200,
            body: {
                users: [
                    {
                        id: '1',
                        name: 'Alice',
                    },
                ],
            },
        }),
        getUser: ({ params }: { params: { id: string } }) => ({
            status: 200,
            body: {
                id: params.id,
                name: 'Alice',
            },
        }),
        createUser: ({ body }: { body: { name: string; email: string } }) => ({
            status: 201,
            body: {
                id: '1',
                name: body.name,
                email: body.email,
            },
        }),
    },
    health: () => ({
        status: 200,
        body: {
            ok: true,
        },
    }),
};

const api = assembleApi(contract, {
    router,
});

const startServer = async (): Promise<{ port: number; app: FastifyInstance }> => {
    const app = Fastify();

    app.register(fastifyKizunaMcp, {
        api,
    });

    const address = await app.listen({
        port: 0,
    });
    const port = Number(new URL(address).port);

    return {
        port,
        app,
    };
};

const connectClient = async (port: number): Promise<Client> => {
    const client = new Client({
        name: 'test-client',
        version: '1.0.0',
    });

    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
    await client.connect(transport);
    return client;
};

describe('fastifyKizunaMcp — Fastify e2e', () => {
    let app: FastifyInstance | undefined;
    let client: Client | undefined;

    afterEach(async () => {
        await client?.close();
        await app?.close();
        app = undefined;
        client = undefined;
    });

    it('lists tools over HTTP', async () => {
        const result = await startServer();
        app = result.app;
        client = await connectClient(result.port);

        const { tools } = await client.listTools();
        const names = tools.map((tool) => tool.name);

        expect(names).toContain('users.listUsers');
        expect(names).toContain('users.getUser');
        expect(names).toContain('users.createUser');
        expect(names).toContain('health');
    });

    it('calls a tool and invokes the handler directly', async () => {
        const result = await startServer();
        app = result.app;
        client = await connectClient(result.port);

        const toolResult = await client.callTool({
            name: 'users.getUser',
            arguments: {
                params: {
                    id: '42',
                },
            },
        });

        const content = toolResult.content as Array<{ type: string; text: string }>;
        const parsed = JSON.parse(content[0]!.text);
        expect(parsed.status).toBe(200);
        expect(parsed.body.id).toBe('42');
        expect(parsed.body.name).toBe('Alice');
    });

    it('mounts at custom path', async () => {
        const customApp = Fastify();

        customApp.register(fastifyKizunaMcp, {
            api,
            path: '/api/mcp',
        });

        const address = await customApp.listen({
            port: 0,
        });
        const port = Number(new URL(address).port);
        app = customApp;

        const mcpClient = new Client({
            name: 'test-client',
            version: '1.0.0',
        });
        const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/api/mcp`));
        await mcpClient.connect(transport);
        client = mcpClient;

        const { tools } = await mcpClient.listTools();
        expect(tools.length).toBeGreaterThan(0);
    });
});
