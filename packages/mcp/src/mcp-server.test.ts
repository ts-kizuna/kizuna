import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Kizuna } from '@ts-kizuna/core';
import { assembleApi, type GuardDeny } from '@ts-kizuna/core/adapter';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/client';
import { buildInstructions, buildToolDefinitions, createMcpServer } from './mcp-server.js';

const k = new Kizuna({
    groups: Kizuna.groups({
        api: 'API',
    }),
});

const contractRoutes = k.routes.api({
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
        getUser: ({
            params,
            throwError,
        }: {
            params: { id: string };
            throwError: (response: { status: number; body: unknown }) => never;
        }) => {
            if (params.id === '999') {
                throwError({
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
    assembleApi(contract, {
        router: testRouter,
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

        expect(names).toContain('users_list_users');
        expect(names).toContain('users_get_user');
        expect(names).toContain('users_create_user');
        expect(names).toContain('health');
        expect(names).toContain('ping_user');
    });

    it('excludes multipart/form-data routes by default', () => {
        const definitions = buildToolDefinitions(contract.routes, baseOptions);
        const names = definitions.map((definition) => definition.name);

        expect(names).not.toContain('upload_avatar');
    });

    it('carries the summary as the tool title', () => {
        const definitions = buildToolDefinitions(contract.routes, baseOptions);
        const listUsers = definitions.find((definition) => definition.name === 'users_list_users')!;
        const health = definitions.find((definition) => definition.name === 'health')!;

        expect(listUsers.title).toBe('List users with pagination');
        expect(health.title).toBeUndefined();
    });
});

describe('buildToolDefinitions: selection', () => {
    const names = (options: Parameters<typeof buildToolDefinitions>[1]) =>
        buildToolDefinitions(contract.routes, options).map((definition) => definition.name);

    it('takes every route when nothing is selected', () => {
        expect(names(baseOptions)).toEqual(
            expect.arrayContaining(['users_list_users', 'users_get_user', 'users_create_user', 'health', 'delete_user'])
        );
    });

    it('drops a route the map sets to false', () => {
        const selected = names({
            tools: {
                deleteUser: false,
            },
        });

        expect(selected).not.toContain('delete_user');
        expect(selected).toContain('users_get_user');
    });

    it('drops a whole group set to false', () => {
        const selected = names({
            tools: {
                users: false,
            },
        });

        expect(selected).not.toContain('users_get_user');
        expect(selected).not.toContain('users_create_user');
        expect(selected).toContain('health');
    });

    it('lets a route override its group default', () => {
        const selected = names({
            tools: {
                users: {
                    '*': false,
                    getUser: true,
                },
            },
        });

        expect(selected).toContain('users_get_user');
        expect(selected).not.toContain('users_create_user');
        expect(selected).toContain('health');
    });

    it('curates down to a few tools with a top level star', () => {
        const selected = names({
            tools: {
                '*': false,
                users: {
                    getUser: true,
                },
            },
        });

        expect(selected).toEqual(['users_get_user']);
    });

    it('exposes a route the map never mentions', () => {
        const selected = names({
            tools: {
                deleteUser: false,
            },
        });

        expect(selected).toContain('health');
    });

    it('keeps multipart routes out whatever the map says', () => {
        const selected = names({
            tools: {
                uploadAvatar: true,
            },
        });

        expect(selected).not.toContain('upload_avatar');
    });

    it('keeps multipart routes out even when the map asks for them', () => {
        const selected = names({
            tools: {
                uploadAvatar: true,
            },
        });

        expect(selected).not.toContain('upload_avatar');
    });

    it('keeps only safe methods under onlyReadOnly', () => {
        const selected = names({
            onlyReadOnly: true,
        });

        expect(selected).toContain('users_get_user');
        expect(selected).toContain('health');
        expect(selected).not.toContain('users_create_user');
        expect(selected).not.toContain('delete_user');
        expect(selected).not.toContain('update_user');
    });
});

describe('buildToolDefinitions: input schema', () => {
    it('puts query under a query key', () => {
        const definitions = buildToolDefinitions(contract.routes, baseOptions);
        const listUsers = definitions.find((definition) => definition.name === 'users_list_users')!;

        expect(listUsers.inputSchema.shape).toBeDefined();
        expect(listUsers.inputSchema.hasQuery).toBe(true);
        expect(listUsers.inputSchema.hasParams).toBe(false);
        expect(listUsers.inputSchema.hasBody).toBe(false);
        expect(listUsers.inputSchema.shape!['query']).toBeDefined();
    });

    it('leaves an all-optional query out of required', () => {
        const definitions = buildToolDefinitions(contract.routes, baseOptions);
        const listUsers = definitions.find((definition) => definition.name === 'users_list_users')!;

        expect(z.object(listUsers.inputSchema.shape!).safeParse({}).success).toBe(true);
        expect(z.toJSONSchema(z.object(listUsers.inputSchema.shape!)).required ?? []).not.toContain('query');
    });

    it('puts path params under a params key', () => {
        const definitions = buildToolDefinitions(contract.routes, baseOptions);
        const getUser = definitions.find((definition) => definition.name === 'users_get_user')!;

        expect(getUser.inputSchema.shape).toBeDefined();
        expect(getUser.inputSchema.hasParams).toBe(true);
        expect(getUser.inputSchema.shape!['params']).toBeDefined();
    });

    it('puts body under a body key', () => {
        const definitions = buildToolDefinitions(contract.routes, baseOptions);
        const createUser = definitions.find((definition) => definition.name === 'users_create_user')!;

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
        const ping = definitions.find((definition) => definition.name === 'ping_user')!;

        expect(ping.inputSchema.hasParams).toBe(true);
        expect(ping.inputSchema.hasBody).toBe(false);
        expect(ping.inputSchema.shape!['body']).toBeUndefined();
        expect(ping.inputSchema.shape!['params']).toBeDefined();
    });

    it('handles non-object body (discriminated union)', () => {
        const unionContractRoutes = k.routes.api({
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
        const send = definitions.find((definition) => definition.name === 'send_notification')!;

        expect(send.inputSchema.hasBody).toBe(true);
        expect(send.inputSchema.shape!['body']).toBeDefined();
    });

    it('combines params, query, and body for complex routes', () => {
        const complexContractRoutes = k.routes.api({
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
        const update = definitions.find((definition) => definition.name === 'update_item')!;

        expect(update.inputSchema.hasParams).toBe(true);
        expect(update.inputSchema.hasQuery).toBe(true);
        expect(update.inputSchema.hasBody).toBe(true);
        expect(update.inputSchema.shape!['params']).toBeDefined();
        expect(update.inputSchema.shape!['query']).toBeDefined();
        expect(update.inputSchema.shape!['body']).toBeDefined();
    });

    it('keeps a query with a required field required', () => {
        const contractRoutesWithRequiredQuery = k.routes.api({
            searchItems: {
                method: 'GET',
                path: '/items',
                query: z.object({
                    term: z.string(),
                    page: z.number().optional(),
                }),
                responses: {
                    200: z.object({
                        ids: z.array(z.string()),
                    }),
                },
            },
        });

        const definitions = buildToolDefinitions(
            k.contract({
                routes: contractRoutesWithRequiredQuery,
            }).routes
        );
        const search = definitions.find((definition) => definition.name === 'search_items')!;

        expect(z.toJSONSchema(z.object(search.inputSchema.shape!)).required).toContain('query');
    });
});

describe('tool annotations', () => {
    it('marks GET routes as readOnly', async () => {
        const { client, close } = await connectMcpClient();

        const { tools } = await client.listTools();
        const getUser = tools.find((tool) => tool.name === 'users_get_user')!;

        expect(getUser.annotations?.readOnlyHint).toBe(true);
        expect(getUser.annotations?.destructiveHint).toBeUndefined();

        await close();
    });

    it('marks DELETE routes as destructive', async () => {
        const { client, close } = await connectMcpClient();

        const { tools } = await client.listTools();
        const deleteUser = tools.find((tool) => tool.name === 'delete_user')!;

        expect(deleteUser.annotations?.destructiveHint).toBe(true);
        expect(deleteUser.annotations?.readOnlyHint).toBeUndefined();

        await close();
    });

    it('marks PUT routes as idempotent', async () => {
        const { client, close } = await connectMcpClient();

        const { tools } = await client.listTools();
        const updateUser = tools.find((tool) => tool.name === 'update_user')!;

        expect(updateUser.annotations?.idempotentHint).toBe(true);
        expect(updateUser.annotations?.destructiveHint).toBeUndefined();
        expect(updateUser.annotations?.readOnlyHint).toBeUndefined();

        await close();
    });

    it('marks safe methods idempotent too, per RFC 9110', async () => {
        const { client, close } = await connectMcpClient();

        const { tools } = await client.listTools();
        const getUser = tools.find((tool) => tool.name === 'users_get_user')!;

        expect(getUser.annotations?.idempotentHint).toBe(true);

        await close();
    });

    it('marks DELETE idempotent, which RFC 9110 says it is', async () => {
        const { client, close } = await connectMcpClient();

        const { tools } = await client.listTools();
        const deleteUser = tools.find((tool) => tool.name === 'delete_user')!;

        expect(deleteUser.annotations?.idempotentHint).toBe(true);

        await close();
    });

    it('POST routes have no special annotations', async () => {
        const { client, close } = await connectMcpClient();

        const { tools } = await client.listTools();
        const createUser = tools.find((tool) => tool.name === 'users_create_user')!;

        expect(createUser.annotations?.readOnlyHint).toBeUndefined();
        expect(createUser.annotations?.destructiveHint).toBeUndefined();
        expect(createUser.annotations?.idempotentHint).toBeUndefined();

        await close();
    });
});

describe('buildToolDefinitions: output schema', () => {
    it('describes the status and body envelope', async () => {
        const { client, close } = await connectMcpClient();

        const { tools } = await client.listTools();
        const getUser = tools.find((tool) => tool.name === 'users_get_user')!;

        expect(getUser.outputSchema).toBeDefined();
        expect(getUser.outputSchema!.properties).toHaveProperty('status');
        expect(getUser.outputSchema!.properties).toHaveProperty('body');

        await close();
    });

    it('takes the body from the success response, not the error one', async () => {
        const { client, close } = await connectMcpClient();

        const { tools } = await client.listTools();
        const getUser = tools.find((tool) => tool.name === 'users_get_user')!;
        const body = (getUser.outputSchema!.properties as Record<string, { properties?: Record<string, unknown> }>)['body']!;

        expect(body.properties).toHaveProperty('id');
        expect(body.properties).not.toHaveProperty('message');

        await close();
    });

    it('describes status alone when the success body is void', async () => {
        const { client, close } = await connectMcpClient();

        const { tools } = await client.listTools();
        const ping = tools.find((tool) => tool.name === 'ping_user')!;

        expect(ping.outputSchema!.properties).toHaveProperty('status');
        expect(ping.outputSchema!.properties).not.toHaveProperty('body');

        await close();
    });
});

describe('instructions', () => {
    it('lists the contract tag groups', () => {
        const instructions = buildInstructions(contract, buildToolDefinitions(contract.routes, baseOptions), undefined);

        expect(instructions).toContain('{ status, body }');
        expect(instructions).toContain('- API');
    });

    it('appends the authored text after the generated overview', () => {
        const instructions = buildInstructions(contract, buildToolDefinitions(contract.routes, baseOptions), 'Every timestamp is UTC.');

        expect(instructions.indexOf('- API')).toBeLessThan(instructions.indexOf('Every timestamp is UTC.'));
    });

    it('leaves out a group whose every route was excluded', () => {
        const trimmed = buildToolDefinitions(contract.routes, {
            tools: {
                '*': false,
            },
        });

        expect(buildInstructions(contract, trimmed, undefined)).not.toContain('- API');
    });

    it('reaches the client over the protocol', async () => {
        const { client, close } = await connectMcpClient(api, {
            instructions: 'Every timestamp is UTC.',
        });

        expect(client.getInstructions()).toContain('Every timestamp is UTC.');

        await close();
    });
});

describe('MCP server e2e', () => {
    it('lists all registered tools via MCP protocol', async () => {
        const { client, close } = await connectMcpClient();

        const { tools } = await client.listTools();
        const names = tools.map((tool) => tool.name);

        expect(names).toContain('users_list_users');
        expect(names).toContain('users_get_user');
        expect(names).toContain('users_create_user');
        expect(names).toContain('health');
        expect(names).toContain('ping_user');
        expect(names).not.toContain('upload_avatar');

        await close();
    });

    it('tools carry descriptions from the contract', async () => {
        const { client, close } = await connectMcpClient();

        const { tools } = await client.listTools();
        const listUsers = tools.find((tool) => tool.name === 'users_list_users')!;

        expect(listUsers.description).toContain('List users with pagination');
        expect(listUsers.description).toContain('HTTP: GET /users');

        await close();
    });

    it('tools have correct input schemas', async () => {
        const { client, close } = await connectMcpClient();

        const { tools } = await client.listTools();
        const getUser = tools.find((tool) => tool.name === 'users_get_user')!;

        expect(getUser.inputSchema.properties).toHaveProperty('params');

        const createUser = tools.find((tool) => tool.name === 'users_create_user')!;
        expect(createUser.inputSchema.properties).toHaveProperty('body');

        await close();
    });

    it('calls a route with an all-optional query with no arguments', async () => {
        const { client, close } = await connectMcpClient();

        const result = await client.callTool({
            name: 'users_list_users',
            arguments: {},
        });

        expect(result.isError).toBe(false);
        expect(result.structuredContent).toEqual({
            status: 200,
            body: {
                users: [
                    {
                        id: '1',
                        name: 'Alice',
                    },
                ],
            },
        });

        await close();
    });

    it('returns the envelope as structured content on success', async () => {
        const { client, close } = await connectMcpClient();

        const result = await client.callTool({
            name: 'users_get_user',
            arguments: {
                params: {
                    id: '42',
                },
            },
        });

        expect(result.structuredContent).toEqual({
            status: 200,
            body: {
                id: '42',
                name: 'Alice',
            },
        });

        await close();
    });

    it('leaves structured content off a failed call', async () => {
        const { client, close } = await connectMcpClient();

        const result = await client.callTool({
            name: 'users_get_user',
            arguments: {
                params: {
                    id: '999',
                },
            },
        });

        expect(result.isError).toBe(true);
        expect(result.structuredContent).toBeUndefined();

        await close();
    });

    it('invokes handler for a GET with path params', async () => {
        const { client, close } = await connectMcpClient();

        const result = await client.callTool({
            name: 'users_get_user',
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
            name: 'users_create_user',
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
            name: 'users_list_users',
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

    it('returns isError when handler calls throwError()', async () => {
        const { client, close } = await connectMcpClient();

        const result = await client.callTool({
            name: 'users_get_user',
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
            name: 'ping_user',
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

describe('MCP server: guards', () => {
    const user = Kizuna.identity.bearer({
        context: z.object({
            userId: z.string(),
        }),
        access: z.object({
            role: z.enum(['owner', 'admin', 'member']),
        }),
    });

    const securedK = new Kizuna({
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
        ownerOnly: {
            method: 'GET',
            path: '/owner-only',
            responses: {
                200: z.object({
                    ok: z.boolean(),
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
                    user: {
                        role: ['owner', 'admin'],
                    },
                },
            },
        },
    });

    const makeSecuredApi = () => {
        return assembleApi(securedContract, {
            router: {
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
            guards: {
                user: ({ bearer, deny }: { bearer: { token: string } | null; deny: GuardDeny }) => {
                    if (bearer?.token !== 'tok_ada') return deny(401, 'Unauthorized');
                    return {
                        userId: '1',
                    };
                },
            },
        }) as Parameters<typeof createMcpServer>[0];
    };

    it('keeps secured routes in the tool list', async () => {
        const { client, close } = await connectMcpClient(makeSecuredApi());
        const { tools } = await client.listTools();
        const names = tools.map((tool) => tool.name);
        expect(names).toContain('api_who_am_i');
        expect(names).toContain('api_public_route');
        await close();
    });

    it('names the required identities in the tool description', async () => {
        const { client, close } = await connectMcpClient(makeSecuredApi());
        const { tools } = await client.listTools();

        const whoAmI = tools.find((tool) => tool.name === 'api_who_am_i')!;
        const gated = tools.find((tool) => tool.name === 'api_owner_only')!;
        const publicRoute = tools.find((tool) => tool.name === 'api_public_route')!;

        expect(whoAmI.description).toContain('Requires: user');
        expect(gated.description).toContain('Requires: user (role: owner, admin)');
        expect(publicRoute.description).not.toContain('Requires:');

        await close();
    });

    it('denies a secured tool call without a credential', async () => {
        const { client, close } = await connectMcpClient(makeSecuredApi());
        const result = await client.callTool({
            name: 'api_who_am_i',
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
            name: 'api_who_am_i',
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

    it('skips the transport-verified scheme and hands its context to the handler', async () => {
        const { client, close } = await connectMcpClient(makeSecuredApi(), {
            transportAuth: {
                scheme: 'user',
                context: {
                    userId: '7',
                },
            },
        });
        const result = await client.callTool({
            name: 'api_who_am_i',
            arguments: {},
        });
        const content = result.content as Array<{ type: string; text: string }>;
        const parsed = JSON.parse(content[0]!.text);
        expect(parsed.status).toBe(200);
        expect(parsed.body).toEqual({
            userId: '7',
        });
        await close();
    });

    it('serves public tools without guards', async () => {
        const { client, close } = await connectMcpClient(makeSecuredApi());
        const result = await client.callTool({
            name: 'api_public_route',
            arguments: {},
        });
        const content = result.content as Array<{ type: string; text: string }>;
        const parsed = JSON.parse(content[0]!.text);
        expect(parsed.status).toBe(200);
        await close();
    });

    it('errors clearly when a secured tool has no registered guard', async () => {
        const apiWithoutGuards = assembleApi(securedContract, {
            router: {
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
            name: 'api_who_am_i',
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
