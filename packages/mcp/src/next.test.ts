import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Kizuna } from '@ts-kizuna/core';
import { assembleApi } from '@ts-kizuna/core/adapter';
import { mcpPlugin } from './next.js';

const { k } = Kizuna.init({
    tags: Kizuna.tags({
        api: 'API',
    }),
});

const contract = k.contract({
    routes: k.routes('api', {
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
});

const api = assembleApi(contract, {
    router: {
        getUser: ({ params }: { params: { id: string } }) => ({
            status: 200,
            body: {
                id: params.id,
                name: 'Alice',
            },
        }),
    },
});

type Handler = (request: Request) => Promise<Response>;

const createHost = () => {
    const registered = new Map<string, Handler>();
    return {
        registered,
        host: {
            get: (path: string, handler: Handler) => registered.set(`GET ${path}`, handler),
            post: (path: string, handler: Handler) => registered.set(`POST ${path}`, handler),
            delete: (path: string, handler: Handler) => registered.set(`DELETE ${path}`, handler),
        },
    };
};

const initialize = (path: string, handler: Handler): Promise<Response> =>
    handler(
        new Request(`http://localhost${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: {
                    protocolVersion: '2025-06-18',
                    capabilities: {},
                    clientInfo: {
                        name: 'test-client',
                        version: '1.0.0',
                    },
                },
            }),
        })
    );

describe('mcpPlugin — Next.js', () => {
    it('registers the three methods the transport needs', () => {
        const { registered, host } = createHost();
        mcpPlugin().mount(host, api);

        expect([...registered.keys()].sort()).toEqual(['DELETE /mcp', 'GET /mcp', 'POST /mcp']);
    });

    it('registers at a custom path', () => {
        const { registered, host } = createHost();
        mcpPlugin({
            path: '/tools',
        }).mount(host, api);

        expect([...registered.keys()].sort()).toEqual(['DELETE /tools', 'GET /tools', 'POST /tools']);
    });

    it('serves the MCP protocol from the registered handler', async () => {
        const { registered, host } = createHost();
        mcpPlugin({
            name: 'My API',
        }).mount(host, api);

        const response = await initialize('/mcp', registered.get('POST /mcp')!);
        expect(response.status).toBe(200);

        const text = await response.text();
        expect(text).toContain('"protocolVersion"');
        expect(text).toContain('My API');
    });

    it('rejects GET and DELETE, which the stateless transport does not support', async () => {
        const { registered, host } = createHost();
        mcpPlugin().mount(host, api);

        const get = await registered.get('GET /mcp')!(new Request('http://localhost/mcp'));
        expect(get.status).toBe(405);

        const remove = await registered.get('DELETE /mcp')!(
            new Request('http://localhost/mcp', {
                method: 'DELETE',
            })
        );
        expect(remove.status).toBe(405);
    });
});
