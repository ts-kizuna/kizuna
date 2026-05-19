import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createContract } from '@ts-kizuna/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildToolDefinitions, createMcpServer } from './server.js';

const contract = createContract({
    users: createContract({
        listUsers: {
            method: 'GET',
            path: '/users',
            summary: 'List users with pagination',
            query: z.object({
                page: z.number().optional(),
                limit: z.number().optional(),
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
    uploadAvatar: {
        method: 'POST',
        path: '/avatar',
        contentType: 'multipart/form-data',
        body: z.object({
            file: z.instanceof(File),
        }),
        responses: {
            200: z.object({
                size: z.number(),
            }),
        },
    },
    pingUser: {
        method: 'POST',
        path: '/users/:id/ping',
        body: z.void(),
        responses: {
            204: z.void(),
        },
    },
    deleteUser: {
        method: 'DELETE',
        path: '/users/:id',
        responses: {
            200: z.object({
                success: z.boolean(),
            }),
        },
    },
    updateUser: {
        method: 'PUT',
        path: '/users/:id',
        body: z.object({
            name: z.string(),
        }),
        responses: {
            200: z.object({
                id: z.string(),
                name: z.string(),
            }),
        },
    },
});

const baseOptions = {
    name: 'Test API',
    version: '1.0.0',
    baseUrl: 'https://api.example.com',
};

const connectMcpClient = async (options: Parameters<typeof createMcpServer>[1]) => {
    const server = createMcpServer(contract, options);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({
        name: 'test-client',
        version: '1.0.0',
    });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    return {
        client,
        close: async () => {
            await client.close();
            await server.close();
        },
    };
};

describe('buildToolDefinitions', () => {
    it('generates tool definitions from a contract', () => {
        const definitions = buildToolDefinitions(contract, baseOptions);
        const names = definitions.map((definition) => definition.name);

        expect(names).toContain('users.listUsers');
        expect(names).toContain('users.getUser');
        expect(names).toContain('users.createUser');
        expect(names).toContain('health');
        expect(names).toContain('pingUser');
    });

    it('excludes multipart/form-data routes by default', () => {
        const definitions = buildToolDefinitions(contract, baseOptions);
        const names = definitions.map((definition) => definition.name);

        expect(names).not.toContain('uploadAvatar');
    });

    it('includes multipart routes when routeFilter allows them', () => {
        const definitions = buildToolDefinitions(contract, {
            ...baseOptions,
            routeFilter: () => true,
        });
        const names = definitions.map((definition) => definition.name);

        expect(names).toContain('uploadAvatar');
    });

    it('builds tool descriptions from route summary', () => {
        const definitions = buildToolDefinitions(contract, baseOptions);
        const listUsers = definitions.find((definition) => definition.name === 'users.listUsers')!;

        expect(listUsers.description).toContain('List users with pagination');
        expect(listUsers.description).toContain('HTTP: GET /users');
    });

    it('falls back to METHOD /path when no summary', () => {
        const definitions = buildToolDefinitions(contract, baseOptions);
        const health = definitions.find((definition) => definition.name === 'health')!;

        expect(health.description).toContain('GET /health');
    });
});

describe('buildToolDefinitions — input schema', () => {
    it('puts query under a query key', () => {
        const definitions = buildToolDefinitions(contract, baseOptions);
        const listUsers = definitions.find((definition) => definition.name === 'users.listUsers')!;

        expect(listUsers.inputSchema.shape).toBeDefined();
        expect(listUsers.inputSchema.hasQuery).toBe(true);
        expect(listUsers.inputSchema.hasParams).toBe(false);
        expect(listUsers.inputSchema.hasBody).toBe(false);
        expect(listUsers.inputSchema.shape!['query']).toBeDefined();
    });

    it('puts path params under a params key', () => {
        const definitions = buildToolDefinitions(contract, baseOptions);
        const getUser = definitions.find((definition) => definition.name === 'users.getUser')!;

        expect(getUser.inputSchema.shape).toBeDefined();
        expect(getUser.inputSchema.hasParams).toBe(true);
        expect(getUser.inputSchema.shape!['params']).toBeDefined();
    });

    it('puts body under a body key', () => {
        const definitions = buildToolDefinitions(contract, baseOptions);
        const createUser = definitions.find((definition) => definition.name === 'users.createUser')!;

        expect(createUser.inputSchema.shape).toBeDefined();
        expect(createUser.inputSchema.hasBody).toBe(true);
        expect(createUser.inputSchema.shape!['body']).toBeDefined();
    });

    it('returns undefined shape for routes with no inputs', () => {
        const definitions = buildToolDefinitions(contract, baseOptions);
        const health = definitions.find((definition) => definition.name === 'health')!;

        expect(health.inputSchema.shape).toBeUndefined();
    });

    it('excludes void body from the input schema', () => {
        const definitions = buildToolDefinitions(contract, baseOptions);
        const ping = definitions.find((definition) => definition.name === 'pingUser')!;

        expect(ping.inputSchema.hasParams).toBe(true);
        expect(ping.inputSchema.hasBody).toBe(false);
        expect(ping.inputSchema.shape!['body']).toBeUndefined();
        expect(ping.inputSchema.shape!['params']).toBeDefined();
    });

    it('handles non-object body (discriminated union)', () => {
        const unionContract = createContract({
            sendNotification: {
                method: 'POST',
                path: '/notifications',
                body: z.discriminatedUnion('channel', [
                    z.object({
                        channel: z.literal('email'),
                        to: z.string(),
                    }),
                    z.object({
                        channel: z.literal('sms'),
                        phone: z.string(),
                    }),
                ]),
                responses: {
                    202: z.object({
                        accepted: z.boolean(),
                    }),
                },
            },
        });

        const definitions = buildToolDefinitions(unionContract, baseOptions);
        const send = definitions.find((definition) => definition.name === 'sendNotification')!;

        expect(send.inputSchema.hasBody).toBe(true);
        expect(send.inputSchema.shape!['body']).toBeDefined();
    });

    it('combines params, query, and body for complex routes', () => {
        const complexContract = createContract({
            updateItem: {
                method: 'PUT',
                path: '/items/:id',
                query: z.object({
                    version: z.number(),
                }),
                body: z.object({
                    name: z.string(),
                }),
                responses: {
                    200: z.object({
                        id: z.string(),
                    }),
                },
            },
        });

        const definitions = buildToolDefinitions(complexContract, baseOptions);
        const update = definitions.find((definition) => definition.name === 'updateItem')!;

        expect(update.inputSchema.hasParams).toBe(true);
        expect(update.inputSchema.hasQuery).toBe(true);
        expect(update.inputSchema.hasBody).toBe(true);
        expect(update.inputSchema.shape!['params']).toBeDefined();
        expect(update.inputSchema.shape!['query']).toBeDefined();
        expect(update.inputSchema.shape!['body']).toBeDefined();
    });
});

describe('tool annotations', () => {
    it('marks GET routes as readOnly', async () => {
        const mockFetch = vi.fn();
        const { client, close } = await connectMcpClient({
            ...baseOptions,
            fetch: mockFetch,
        });

        const { tools } = await client.listTools();
        const getUser = tools.find((tool) => tool.name === 'users.getUser')!;

        expect(getUser.annotations?.readOnlyHint).toBe(true);
        expect(getUser.annotations?.destructiveHint).toBeUndefined();

        await close();
    });

    it('marks DELETE routes as destructive', async () => {
        const mockFetch = vi.fn();
        const { client, close } = await connectMcpClient({
            ...baseOptions,
            fetch: mockFetch,
        });

        const { tools } = await client.listTools();
        const deleteUser = tools.find((tool) => tool.name === 'deleteUser')!;

        expect(deleteUser.annotations?.destructiveHint).toBe(true);
        expect(deleteUser.annotations?.readOnlyHint).toBeUndefined();

        await close();
    });

    it('marks PUT routes as idempotent', async () => {
        const mockFetch = vi.fn();
        const { client, close } = await connectMcpClient({
            ...baseOptions,
            fetch: mockFetch,
        });

        const { tools } = await client.listTools();
        const updateUser = tools.find((tool) => tool.name === 'updateUser')!;

        expect(updateUser.annotations?.idempotentHint).toBe(true);
        expect(updateUser.annotations?.destructiveHint).toBeUndefined();
        expect(updateUser.annotations?.readOnlyHint).toBeUndefined();

        await close();
    });

    it('POST routes have no special annotations', async () => {
        const mockFetch = vi.fn();
        const { client, close } = await connectMcpClient({
            ...baseOptions,
            fetch: mockFetch,
        });

        const { tools } = await client.listTools();
        const createUser = tools.find((tool) => tool.name === 'users.createUser')!;

        expect(createUser.annotations?.readOnlyHint).toBeUndefined();
        expect(createUser.annotations?.destructiveHint).toBeUndefined();
        expect(createUser.annotations?.idempotentHint).toBeUndefined();

        await close();
    });
});

describe('MCP server e2e', () => {
    it('lists all registered tools via MCP protocol', async () => {
        const mockFetch = vi.fn();
        const { client, close } = await connectMcpClient({
            ...baseOptions,
            fetch: mockFetch,
        });

        const { tools } = await client.listTools();
        const names = tools.map((tool) => tool.name);

        expect(names).toContain('users.listUsers');
        expect(names).toContain('users.getUser');
        expect(names).toContain('users.createUser');
        expect(names).toContain('health');
        expect(names).toContain('pingUser');
        expect(names).not.toContain('uploadAvatar');

        await close();
    });

    it('tools carry descriptions from the contract', async () => {
        const mockFetch = vi.fn();
        const { client, close } = await connectMcpClient({
            ...baseOptions,
            fetch: mockFetch,
        });

        const { tools } = await client.listTools();
        const listUsers = tools.find((tool) => tool.name === 'users.listUsers')!;

        expect(listUsers.description).toContain('List users with pagination');
        expect(listUsers.description).toContain('HTTP: GET /users');

        await close();
    });

    it('tools have correct input schemas', async () => {
        const mockFetch = vi.fn();
        const { client, close } = await connectMcpClient({
            ...baseOptions,
            fetch: mockFetch,
        });

        const { tools } = await client.listTools();
        const getUser = tools.find((tool) => tool.name === 'users.getUser')!;

        expect(getUser.inputSchema.properties).toHaveProperty('params');

        const createUser = tools.find((tool) => tool.name === 'users.createUser')!;
        expect(createUser.inputSchema.properties).toHaveProperty('body');

        await close();
    });

    it('calls fetch with correct URL and method for a GET with path params', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            status: 200,
            text: async () =>
                JSON.stringify({
                    id: '42',
                    name: 'Alice',
                }),
        });

        const { client, close } = await connectMcpClient({
            ...baseOptions,
            fetch: mockFetch,
        });

        const result = await client.callTool({
            name: 'users.getUser',
            arguments: {
                params: {
                    id: '42',
                },
            },
        });

        expect(mockFetch).toHaveBeenCalledOnce();
        const [url, options] = mockFetch.mock.calls[0]!;
        expect(url).toBe('https://api.example.com/users/42');
        expect(options.method).toBe('GET');

        const content = result.content as Array<{ type: string; text: string }>;
        const parsed = JSON.parse(content[0]!.text);
        expect(parsed.status).toBe(200);
        expect(parsed.body.name).toBe('Alice');

        await close();
    });

    it('calls fetch with correct body for a POST', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            status: 201,
            text: async () =>
                JSON.stringify({
                    id: '1',
                    name: 'Bob',
                    email: 'bob@example.com',
                }),
        });

        const { client, close } = await connectMcpClient({
            ...baseOptions,
            fetch: mockFetch,
        });

        await client.callTool({
            name: 'users.createUser',
            arguments: {
                body: {
                    name: 'Bob',
                    email: 'bob@example.com',
                },
            },
        });

        expect(mockFetch).toHaveBeenCalledOnce();
        const [url, options] = mockFetch.mock.calls[0]!;
        expect(url).toBe('https://api.example.com/users');
        expect(options.method).toBe('POST');
        expect(options.headers['Content-Type']).toBe('application/json');
        expect(JSON.parse(options.body)).toEqual({
            name: 'Bob',
            email: 'bob@example.com',
        });

        await close();
    });

    it('appends query params to URL', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            status: 200,
            text: async () =>
                JSON.stringify({
                    users: [],
                }),
        });

        const { client, close } = await connectMcpClient({
            ...baseOptions,
            fetch: mockFetch,
        });

        await client.callTool({
            name: 'users.listUsers',
            arguments: {
                query: {
                    page: 2,
                    limit: 25,
                },
            },
        });

        expect(mockFetch).toHaveBeenCalledOnce();
        const [url] = mockFetch.mock.calls[0]!;
        const parsed = new URL(url);
        expect(parsed.searchParams.get('page')).toBe('2');
        expect(parsed.searchParams.get('limit')).toBe('25');

        await close();
    });

    it('sends baseHeaders with every request', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            status: 200,
            text: async () =>
                JSON.stringify({
                    ok: true,
                }),
        });

        const { client, close } = await connectMcpClient({
            ...baseOptions,
            baseHeaders: {
                Authorization: 'Bearer test-token',
            },
            fetch: mockFetch,
        });

        await client.callTool({
            name: 'health',
            arguments: {},
        });

        expect(mockFetch).toHaveBeenCalledOnce();
        const [, options] = mockFetch.mock.calls[0]!;
        expect(options.headers['Authorization']).toBe('Bearer test-token');

        await close();
    });

    it('returns isError for 4xx responses', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            status: 404,
            text: async () =>
                JSON.stringify({
                    message: 'User not found',
                }),
        });

        const { client, close } = await connectMcpClient({
            ...baseOptions,
            fetch: mockFetch,
        });

        const result = await client.callTool({
            name: 'users.getUser',
            arguments: {
                params: {
                    id: '999',
                },
            },
        });

        expect(result.isError).toBe(true);
        const content = result.content as Array<{ type: string; text: string }>;
        const parsed = JSON.parse(content[0]!.text);
        expect(parsed.status).toBe(404);
        expect(parsed.body.message).toBe('User not found');

        await close();
    });

    it('handles void body route (no body sent)', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            status: 204,
            text: async () => '',
        });

        const { client, close } = await connectMcpClient({
            ...baseOptions,
            fetch: mockFetch,
        });

        await client.callTool({
            name: 'pingUser',
            arguments: {
                params: {
                    id: '42',
                },
            },
        });

        expect(mockFetch).toHaveBeenCalledOnce();
        const [url, options] = mockFetch.mock.calls[0]!;
        expect(url).toBe('https://api.example.com/users/42/ping');
        expect(options.method).toBe('POST');
        expect(options.body).toBeUndefined();

        await close();
    });
});
