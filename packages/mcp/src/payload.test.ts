import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Config, PayloadRequest } from 'payload';
import { createContract } from '@ts-kizuna/core';
import { createApi as coreCreateApi, ROUTER_META } from '@ts-kizuna/core/adapter';
import { kizunaMcpPlugin } from './payload.js';

const contract = createContract({
    users: createContract({
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
            },
        },
    }),
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
    },
    health: () => ({
        status: 200,
        body: {
            ok: true,
        },
    }),
};

const api = Object.assign(coreCreateApi(contract), {
    [ROUTER_META]: router,
});

describe('kizunaMcpPlugin', () => {
    it('registers POST, GET, and DELETE endpoints at /mcp', () => {
        const plugin = kizunaMcpPlugin(api);
        const config = plugin({} as Config);

        const mcpEndpoints = config.endpoints!.filter((endpoint) => endpoint.path === '/mcp');
        expect(mcpEndpoints).toHaveLength(3);

        const methods = mcpEndpoints.map((endpoint) => endpoint.method).sort();
        expect(methods).toEqual(['delete', 'get', 'post']);
    });

    it('registers at a custom path', () => {
        const plugin = kizunaMcpPlugin(api, {
            path: '/ai',
        });
        const config = plugin({} as Config);

        const mcpEndpoints = config.endpoints!.filter((endpoint) => endpoint.path === '/ai');
        expect(mcpEndpoints).toHaveLength(3);
    });

    it('preserves existing endpoints', () => {
        const existing = {
            path: '/existing',
            method: 'get' as const,
            handler: async () => Response.json({ ok: true }),
        };

        const plugin = kizunaMcpPlugin(api);
        const config = plugin({
            endpoints: [existing],
        } as unknown as Config);

        expect(config.endpoints).toHaveLength(4);
        expect(config.endpoints!.find((endpoint) => endpoint.path === '/existing')).toBeDefined();
    });

    it('GET /mcp returns 405', async () => {
        const plugin = kizunaMcpPlugin(api);
        const config = plugin({} as Config);
        const getEndpoint = config.endpoints!.find((endpoint) => endpoint.path === '/mcp' && endpoint.method === 'get')!;

        const req = new Request('http://localhost/api/mcp') as unknown as PayloadRequest;
        const response = await getEndpoint.handler(req);
        expect(response.status).toBe(405);
    });

    it('DELETE /mcp returns 405', async () => {
        const plugin = kizunaMcpPlugin(api);
        const config = plugin({} as Config);
        const deleteEndpoint = config.endpoints!.find((endpoint) => endpoint.path === '/mcp' && endpoint.method === 'delete')!;

        const req = new Request('http://localhost/api/mcp', {
            method: 'DELETE',
        }) as unknown as PayloadRequest;
        const response = await deleteEndpoint.handler(req);
        expect(response.status).toBe(405);
    });

    it('POST /mcp handles MCP initialize request', async () => {
        const plugin = kizunaMcpPlugin(api);
        const config = plugin({} as Config);
        const postEndpoint = config.endpoints!.find((endpoint) => endpoint.path === '/mcp' && endpoint.method === 'post')!;

        const initRequest = {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2025-03-26',
                capabilities: {},
                clientInfo: {
                    name: 'test',
                    version: '1.0.0',
                },
            },
        };

        const req = new Request('http://localhost/api/mcp', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                accept: 'application/json, text/event-stream',
            },
            body: JSON.stringify(initRequest),
        }) as unknown as PayloadRequest;

        const response = await postEndpoint.handler(req);
        expect(response.status).toBe(200);
        const text = await response.text();
        const dataLine = text.split('\n').find((line) => line.startsWith('data: '));
        expect(dataLine).toBeDefined();
        const body = JSON.parse(dataLine!.slice('data: '.length));
        expect(body.result.serverInfo).toBeDefined();
        expect(body.result.capabilities.tools).toBeDefined();
    });
});
