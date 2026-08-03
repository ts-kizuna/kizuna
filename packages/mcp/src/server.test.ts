import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { kizuna, createTags, createIdentity } from '@ts-kizuna/core';
import { createApi as coreCreateApi, ROUTER_META, GUARDS_META, SCHEMES_META, type GuardDeny } from '@ts-kizuna/core/adapter';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildToolDefinitions, createMcpServer } from './server.js';

const { k } = kizuna({
    tags: createTags({
        api: 'API',
    }),
});

const contractRoutes = k.routes('api', {
    users: {
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
    streamActivity: {
        method: 'GET',
        path: '/activity/stream',
        responses: {
            200: {
                stream: 'sse',
                event: z.object({
                    message: z.string(),
                }),
            },
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

const contract = k.contract({
    routes: contractRoutes,
});

const router = {
    users: {
        listUsers: ({ query }: { query: { page?: number; limit?: number } }) => ({
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
        getUser: ({ params, error }: { params: { id: string }; error: (response: { status: number; body: unknown }) => never }) => {
            if (params.id === '999') {
                error({
                    status: 404,
                    body: {
                        message: 'User not found',
                    },
                });
            }
            return {
                status: 200,
                body: {
                    id: params.id,
                    name: 'Alice',
                },
            };
        },
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
    uploadAvatar: () => ({
        status: 200,
        body: {
            size: 1024,
        },
    }),
    streamActivity: () => ({
        status: 200 as const,
        stream: async function* () {
            yield {
                message: 'hello',
            };
        },
    }),
    pingUser: () => ({
        status: 204,
        body: undefined,
    }),
    deleteUser: ({ params }: { params: { id: string } }) => ({
        status: 200,
        body: {
            success: true,
        },
    }),
    updateUser: ({ params, body }: { params: { id: string }; body: { name: string } }) => ({
        status: 200,
        body: {
            id: params.id,
            name: body.name,
        },
    }),
};

const buildApi = (testRouter: Record<string, unknown> = router) =>
    Object.assign(coreCreateApi(contract.routes), {
        [ROUTER_META]: testRouter,
    });

const api = buildApi();

const baseOptions = {
    name: 'Test API',
    version: '1.0.0',
};

const connectMcpClient = async (testApi: Parameters<typeof createMcpServer>[0] = api, options?: Parameters<typeof createMcpServer>[1]) => {
    const server = createMcpServer(testApi, {
        ...baseOptions,
        ...options,
    });
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
        const definitions = buildToolDefinitions(contract.routes, baseOptions);
        const names = definitions.map((definition) => definition.name);

        expect(names).toContain('users.listUsers');
        expect(names).toContain('users.getUser');
        expect(names).toContain('users.createUser');
        expect(names).toContain('health');
        expect(names).toContain('pingUser');
    });

    it('excludes multipart/form-data routes by default', () => {
        const definitions = buildToolDefinitions(contract.routes, baseOptions);
        const names = definitions.map((definition) => definition.name);

        expect(names).not.toContain('uploadAvatar');
    });

    it('excludes streaming routes by default', () => {
        const definitions = buildToolDefinitions(contract.routes, baseOptions);
        const names = definitions.map((definition) => definition.name);

        expect(names).not.toContain('streamActivity');
    });

    it('includes multipart routes when routeFilter allows them', () => {
        const definitions = buildToolDefinitions(contract.routes, {
            routeFilter: () => true,
        });
        const names = definitions.map((definition) => definition.name);

        expect(names).toContain('uploadAvatar');
    });

    it('builds tool descriptions from route summary', () => {
        const definitions = buildToolDefinitions(contract.routes, baseOptions);
        const listUsers = definitions.find((definition) => definition.name === 'users.listUsers')!;

        expect(listUsers.description).toContain('List users with pagination');
        expect(listUsers.description).toContain('HTTP: GET /users');
    });

    it('falls back to METHOD /path when no summary', () => {
        const definitions = buildToolDefinitions(contract.routes, baseOptions);
        const health = definitions.find((definition) => definition.name === 'health')!;

        expect(health.description).toContain('GET /health');
    });
});

describe('buildToolDefinitions — input schema', () => {
    it('puts query under a query key', () => {
        const definitions = buildToolDefinitions(contract.routes, baseOptions);
        const listUsers = definitions.find((definition) => definition.name === 'users.listUsers')!;

        expect(listUsers.inputSchema.shape).toBeDefined();
        expect(listUsers.inputSchema.hasQuery).toBe(true);
        expect(listUsers.inputSchema.hasParams).toBe(false);
        expect(listUsers.inputSchema.hasBody).toBe(false);
        expect(listUsers.inputSchema.shape!['query']).toBeDefined();
    });

    it('puts path params under a params key', () => {
        const definitions = buildToolDefinitions(contract.routes, baseOptions);
        const getUser = definitions.find((definition) => definition.name === 'users.getUser')!;

        expect(getUser.inputSchema.shape).toBeDefined();
        expect(getUser.inputSchema.hasParams).toBe(true);
        expect(getUser.inputSchema.shape!['params']).toBeDefined();
    });

    it('puts body under a body key', () => {
        const definitions = buildToolDefinitions(contract.routes, baseOptions);
        const createUser = definitions.find((definition) => definition.name === 'users.createUser')!;

        expect(createUser.inputSchema.shape).toBeDefined();
        expect(createUser.inputSchema.hasBody).toBe(true);
        expect(createUser.inputSchema.shape!['body']).toBeDefined();
    });

    it('returns undefined shape for routes with no inputs', () => {
        const definitions = buildToolDefinitions(contract.routes, baseOptions);
        const health = definitions.find((definition) => definition.name === 'health')!;

        expect(health.inputSchema.shape).toBeUndefined();
    });

    it('excludes void body from the input schema', () => {
        const definitions = buildToolDefinitions(contract.routes, baseOptions);
        const ping = definitions.find((definition) => definition.name === 'pingUser')!;

        expect(ping.inputSchema.hasParams).toBe(true);
        expect(ping.inputSchema.hasBody).toBe(false);
        expect(ping.inputSchema.shape!['body']).toBeUndefined();
        expect(ping.inputSchema.shape!['params']).toBeDefined();
    });

    it('handles non-object body (discriminated union)', () => {
        const unionContractRoutes = k.routes('api', {
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

        const unionContract = k.contract({
            routes: unionContractRoutes,
        });

        const definitions = buildToolDefinitions(unionContract.routes);
        const send = definitions.find((definition) => definition.name === 'sendNotification')!;

        expect(send.inputSchema.hasBody).toBe(true);
        expect(send.inputSchema.shape!['body']).toBeDefined();
    });

    it('combines params, query, and body for complex routes', () => {
        const complexContractRoutes = k.routes('api', {
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

        const complexContract = k.contract({
            routes: complexContractRoutes,
        });

        const definitions = buildToolDefinitions(complexContract.routes);
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
        const { client, close } = await connectMcpClient();

        const { tools } = await client.listTools();
        const getUser = tools.find((tool) => tool.name === 'users.getUser')!;

        expect(getUser.annotations?.readOnlyHint).toBe(true);
        expect(getUser.annotations?.destructiveHint).toBeUndefined();

        await close();
    });

    it('marks DELETE routes as destructive', async () => {
        const { client, close } = await connectMcpClient();

        const { tools } = await client.listTools();
        const deleteUser = tools.find((tool) => tool.name === 'deleteUser')!;

        expect(deleteUser.annotations?.destructiveHint).toBe(true);
        expect(deleteUser.annotations?.readOnlyHint).toBeUndefined();

        await close();
    });

    it('marks PUT routes as idempotent', async () => {
        const { client, close } = await connectMcpClient();

        const { tools } = await client.listTools();
        const updateUser = tools.find((tool) => tool.name === 'updateUser')!;

        expect(updateUser.annotations?.idempotentHint).toBe(true);
        expect(updateUser.annotations?.destructiveHint).toBeUndefined();
        expect(updateUser.annotations?.readOnlyHint).toBeUndefined();

        await close();
    });

    it('POST routes have no special annotations', async () => {
        const { client, close } = await connectMcpClient();

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
        const { client, close } = await connectMcpClient();

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
        const { client, close } = await connectMcpClient();

        const { tools } = await client.listTools();
        const listUsers = tools.find((tool) => tool.name === 'users.listUsers')!;

        expect(listUsers.description).toContain('List users with pagination');
        expect(listUsers.description).toContain('HTTP: GET /users');

        await close();
    });

    it('tools have correct input schemas', async () => {
        const { client, close } = await connectMcpClient();

        const { tools } = await client.listTools();
        const getUser = tools.find((tool) => tool.name === 'users.getUser')!;

        expect(getUser.inputSchema.properties).toHaveProperty('params');

        const createUser = tools.find((tool) => tool.name === 'users.createUser')!;
        expect(createUser.inputSchema.properties).toHaveProperty('body');

        await close();
    });

    it('invokes handler for a GET with path params', async () => {
        const { client, close } = await connectMcpClient();

        const result = await client.callTool({
            name: 'users.getUser',
            arguments: {
                params: {
                    id: '42',
                },
            },
        });

        const content = result.content as Array<{ type: string; text: string }>;
        const parsed = JSON.parse(content[0]!.text);
        expect(parsed.status).toBe(200);
        expect(parsed.body.id).toBe('42');
        expect(parsed.body.name).toBe('Alice');

        await close();
    });

    it('invokes handler for a POST with body', async () => {
        const { client, close } = await connectMcpClient();

        const result = await client.callTool({
            name: 'users.createUser',
            arguments: {
                body: {
                    name: 'Bob',
                    email: 'bob@example.com',
                },
            },
        });

        const content = result.content as Array<{ type: string; text: string }>;
        const parsed = JSON.parse(content[0]!.text);
        expect(parsed.status).toBe(201);
        expect(parsed.body.name).toBe('Bob');
        expect(parsed.body.email).toBe('bob@example.com');

        await close();
    });

    it('passes query params to handler', async () => {
        const { client, close } = await connectMcpClient();

        const result = await client.callTool({
            name: 'users.listUsers',
            arguments: {
                query: {
                    page: 2,
                    limit: 25,
                },
            },
        });

        const content = result.content as Array<{ type: string; text: string }>;
        const parsed = JSON.parse(content[0]!.text);
        expect(parsed.status).toBe(200);
        expect(parsed.body.users).toHaveLength(1);

        await close();
    });

    it('returns isError when handler calls error()', async () => {
        const { client, close } = await connectMcpClient();

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

    it('handles void body route', async () => {
        const { client, close } = await connectMcpClient();

        const result = await client.callTool({
            name: 'pingUser',
            arguments: {
                params: {
                    id: '42',
                },
            },
        });

        const content = result.content as Array<{ type: string; text: string }>;
        const parsed = JSON.parse(content[0]!.text);
        expect(parsed.status).toBe(204);

        await close();
    });

    it('returns isError when handler throws', async () => {
        const throwingRouter = {
            ...router,
            health: () => {
                throw new Error('database connection failed');
            },
        };

        const { client, close } = await connectMcpClient(buildApi(throwingRouter));

        const result = await client.callTool({
            name: 'health',
            arguments: {},
        });

        expect(result.isError).toBe(true);
        const content = result.content as Array<{ type: string; text: string }>;
        const parsed = JSON.parse(content[0]!.text);
        expect(parsed.status).toBe(500);
        expect(parsed.body.detail).toBe('database connection failed');

        await close();
    });

    it('passes handlerContext to handlers', async () => {
        let receivedUser: unknown;
        const contextRouter = {
            ...router,
            health: ({ user }: { user: unknown }) => {
                receivedUser = user;
                return {
                    status: 200,
                    body: {
                        ok: true,
                    },
                };
            },
        };

        const { client, close } = await connectMcpClient(buildApi(contextRouter), {
            handlerContext: {
                user: {
                    id: '1',
                    role: 'admin',
                },
            },
        });

        await client.callTool({
            name: 'health',
            arguments: {},
        });

        expect(receivedUser).toEqual({
            id: '1',
            role: 'admin',
        });

        await close();
    });
});

describe('MCP server — guards', () => {
    const user = createIdentity.bearer({
        context: z.object({
            userId: z.string(),
        }),
    });

    const { k: securedK } = kizuna({
        identities: {
            user,
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
    });

    const securedContract = securedK.contract({
        routes: {
            api: securedRoutes,
        },
        auth: {
            api: {
                '*': false,
                whoAmI: 'user',
            },
        },
    });

    const makeSecuredApi = () => {
        const spec = coreCreateApi(securedContract.routes);
        return Object.assign(spec, {
            [ROUTER_META]: {
                api: {
                    publicRoute: () => ({
                        status: 200,
                        body: {
                            ok: true,
                        },
                    }),
                    whoAmI: (args: Record<string, unknown>) => ({
                        status: 200,
                        body: {
                            userId: (args.auth as { user: { userId: string } }).user.userId,
                        },
                    }),
                },
            },
            [GUARDS_META]: {
                user: ({ bearer, deny }: { bearer: { token: string } | null; deny: GuardDeny }) => {
                    if (bearer?.token !== 'tok_ada') return deny(401, 'Unauthorized');
                    return {
                        userId: '1',
                    };
                },
            },
            [SCHEMES_META]: securedContract.securitySchemes,
        }) as Parameters<typeof createMcpServer>[0];
    };

    it('keeps secured routes in the tool list', async () => {
        const { client, close } = await connectMcpClient(makeSecuredApi());
        const { tools } = await client.listTools();
        const names = tools.map((tool) => tool.name);
        expect(names).toContain('api.whoAmI');
        expect(names).toContain('api.publicRoute');
        await close();
    });

    it('denies a secured tool call without a credential', async () => {
        const { client, close } = await connectMcpClient(makeSecuredApi());
        const result = await client.callTool({
            name: 'api.whoAmI',
            arguments: {},
        });
        const content = result.content as Array<{ type: string; text: string }>;
        const parsed = JSON.parse(content[0]!.text);
        expect(result.isError).toBe(true);
        expect(parsed.status).toBe(401);
        expect(parsed.body.detail).toBe('Unauthorized');
        await close();
    });

    it('runs the guard with the transport credential and passes its context to the handler', async () => {
        const { client, close } = await connectMcpClient(makeSecuredApi(), {
            credentialHeaders: {
                authorization: 'Bearer tok_ada',
            },
        });
        const result = await client.callTool({
            name: 'api.whoAmI',
            arguments: {},
        });
        const content = result.content as Array<{ type: string; text: string }>;
        const parsed = JSON.parse(content[0]!.text);
        expect(parsed.status).toBe(200);
        expect(parsed.body).toEqual({
            userId: '1',
        });
        await close();
    });

    it('serves public tools without guards', async () => {
        const { client, close } = await connectMcpClient(makeSecuredApi());
        const result = await client.callTool({
            name: 'api.publicRoute',
            arguments: {},
        });
        const content = result.content as Array<{ type: string; text: string }>;
        const parsed = JSON.parse(content[0]!.text);
        expect(parsed.status).toBe(200);
        await close();
    });

    it('errors clearly when a secured tool has no registered guard', async () => {
        const spec = coreCreateApi(securedContract.routes);
        const apiWithoutGuards = Object.assign(spec, {
            [ROUTER_META]: {
                api: {
                    publicRoute: () => ({
                        status: 200,
                        body: {
                            ok: true,
                        },
                    }),
                    whoAmI: () => ({
                        status: 200,
                        body: {
                            userId: '1',
                        },
                    }),
                },
            },
        }) as Parameters<typeof createMcpServer>[0];
        const { client, close } = await connectMcpClient(apiWithoutGuards);
        const result = await client.callTool({
            name: 'api.whoAmI',
            arguments: {},
        });
        const content = result.content as Array<{ type: string; text: string }>;
        const parsed = JSON.parse(content[0]!.text);
        expect(result.isError).toBe(true);
        expect(parsed.status).toBe(500);
        expect(parsed.body.detail).toContain('No guard registered');
        await close();
    });
});
