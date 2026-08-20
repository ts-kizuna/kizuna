import { describe, expect, it, afterEach } from 'vitest';
import { z } from 'zod';
import express from 'express';
import type { Server } from 'node:http';
import { Kizuna } from '@ts-kizuna/core';
import { KizunaServer } from '@ts-kizuna/express';
import { Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { mcpPlugin } from './plugin.js';
import { mcpPluginServer } from './server.js';

const k = new Kizuna({
    tags: Kizuna.tags({
        api: 'API',
    }),
});

const routes = k.routes('api', {
    getUser: {
        method: 'GET',
        path: '/users/:id',
        summary: 'Get a user by id',
        responses: {
            200: z.object({
                id: z.string(),
                name: z.string(),
            }),
        },
    },
});

const contract = k.contract({
    plugins: {
        mcp: mcpPlugin({
            name: 'Test API',
        }),
    },
    routes,
});

const server = new KizunaServer(contract);

const api = server.api({
    router: {
        getUser: ({ params }) => ({
            status: 200,
            body: {
                id: params.id,
                name: 'Ada',
            },
        }),
    },
    plugins: {
        mcp: mcpPluginServer(),
    },
});

const start = async (): Promise<{ port: number; server: Server }> => {
    const app = express();
    app.use(express.json());
    api.mount(app);
    return new Promise((resolve) => {
        const listening = app.listen(0, () => {
            resolve({
                port: (listening.address() as { port: number }).port,
                server: listening,
            });
        });
    });
};

describe('mcpPlugin', () => {
    let running: Server | undefined;
    let client: Client | undefined;

    afterEach(async () => {
        await client?.close();
        await new Promise<void>((resolve) => {
            if (running) running.close(() => resolve());
            else resolve();
        });
        running = undefined;
        client = undefined;
    });

    const connect = async () => {
        const started = await start();
        running = started.server;
        const connected = new Client({
            name: 'test-client',
            version: '1.0.0',
        });
        await connected.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${started.port}/mcp`)));
        client = connected;
        return connected;
    };

    it('serves MCP from api.mount, with no endpoint wired by hand', async () => {
        const connected = await connect();
        const { tools } = await connected.listTools();
        expect(tools.map((tool) => tool.name)).toContain('getUser');
    });

    it('calls a tool, which runs the contract handler', async () => {
        const connected = await connect();
        const result = await connected.callTool({
            name: 'getUser',
            arguments: {
                params: {
                    id: '42',
                },
            },
        });

        const content = result.content as Array<{ text: string }>;
        const parsed = JSON.parse(content[0]!.text);
        expect(parsed.status).toBe(200);
        expect(parsed.body).toEqual({
            id: '42',
            name: 'Ada',
        });
    });

    it('leaves the endpoint out of the contract, so clients never see it', () => {
        expect(Object.keys(contract.routes)).toEqual(['getUser']);
    });

    it('still serves the contract routes over HTTP', async () => {
        const started = await start();
        running = started.server;
        const response = await fetch(`http://127.0.0.1:${started.port}/users/7`);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            id: '7',
            name: 'Ada',
        });
    });
});

const selective = k.routes('api', {
    listUsers: {
        method: 'GET',
        path: '/users',
        summary: 'List users',
        responses: {
            200: z.array(z.string()),
        },
    },
    health: {
        method: 'GET',
        path: '/health',
        summary: 'Health check',
        responses: {
            200: z.object({
                ok: z.boolean(),
            }),
        },
    },
});

const selectiveContract = k.contract({
    routes: selective,
    plugins: ({ routes: contractRoutes }) => ({
        mcp: mcpPlugin(contractRoutes, {
            name: 'Selective API',
            tools: {
                health: false,
            },
        }),
    }),
});

describe('mcpPlugin: tool selection', () => {
    let running: Server | undefined;
    let client: Client | undefined;

    afterEach(async () => {
        await client?.close();
        await new Promise<void>((resolve) => {
            if (running) running.close(() => resolve());
            else resolve();
        });
        running = undefined;
        client = undefined;
    });

    it('serves only the routes the declaration exposes', async () => {
        const selectiveApi = new KizunaServer(selectiveContract).api({
            router: {
                listUsers: () => ({
                    status: 200,
                    body: ['Ada'],
                }),
                health: () => ({
                    status: 200,
                    body: {
                        ok: true,
                    },
                }),
            },
            plugins: {
                mcp: mcpPluginServer(),
            },
        });

        const app = express();
        app.use(express.json());
        selectiveApi.mount(app);
        const started = await new Promise<{ port: number; server: Server }>((resolve) => {
            const listening = app.listen(0, () => {
                resolve({
                    port: (listening.address() as { port: number }).port,
                    server: listening,
                });
            });
        });
        running = started.server;

        const connected = new Client({
            name: 'test-client',
            version: '1.0.0',
        });
        await connected.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${started.port}/mcp`)));
        client = connected;

        const { tools } = await connected.listTools();
        expect(tools.map((tool) => tool.name)).toEqual(['listUsers']);
    });

    it('still serves an excluded route over HTTP', async () => {
        const selectiveApi = new KizunaServer(selectiveContract).api({
            router: {
                listUsers: () => ({
                    status: 200,
                    body: ['Ada'],
                }),
                health: () => ({
                    status: 200,
                    body: {
                        ok: true,
                    },
                }),
            },
            plugins: {
                mcp: mcpPluginServer(),
            },
        });

        const app = express();
        app.use(express.json());
        selectiveApi.mount(app);
        const started = await new Promise<{ port: number; server: Server }>((resolve) => {
            const listening = app.listen(0, () => {
                resolve({
                    port: (listening.address() as { port: number }).port,
                    server: listening,
                });
            });
        });
        running = started.server;

        const response = await fetch(`http://127.0.0.1:${started.port}/health`);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            ok: true,
        });
    });
});
