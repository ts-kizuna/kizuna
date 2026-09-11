import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Kizuna } from '@ts-kizuna/core';
import { assembleApi, TOOLS_META, type GuardDeny } from '@ts-kizuna/core/adapter';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/client';
import { buildInstructions, toolsOffered, createMcpServer } from './mcp-server.js';

const k = new Kizuna({
    tags: Kizuna.tags({
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

/**
 * Every route in the fixture, named as a tool. There is no selection map any
 * more: a route reaches a model by being written here.
 */
const contractTools = k.tools({
    users: {
        listUsers: k.tools.fromRoutes(contractRoutes.users.listUsers),
        getUser: k.tools.fromRoutes(contractRoutes.users.getUser),
        createUser: k.tools.fromRoutes(contractRoutes.users.createUser),
    },
    health: k.tools.fromRoutes(contractRoutes.health),
    pingUser: k.tools.fromRoutes(contractRoutes.pingUser),
    deleteUser: k.tools.fromRoutes(contractRoutes.deleteUser),
    updateUser: k.tools.fromRoutes(contractRoutes.updateUser),
});

const contract = k.contract({
    routes: contractRoutes,
    tools: contractTools,
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
    Object.assign(
        assembleApi(contract, {
            router: testRouter,
        }),
        {
            // `assembleApi` is the adapter-level helper, so it carries no tools
            // metadata. `server.api` fills this in for a real app.
            [TOOLS_META]: {
                tools: contract.tools!,
                handlers: {},
                router: testRouter,
            },
        }
    );

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
        const { client, close } = await connectMcpClient(
            buildApi({
                ...router,
                health: () => {
                    throw new Error('database connection lost');
                },
            })
        );

        const result = (await client.callTool({
            name: 'health',
            arguments: {},
        })) as { isError?: boolean; content: Array<{ type: string; text: string }> };

        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toContain('database connection lost');

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

    const securedTools = securedK.tools({
        api: {
            publicRoute: securedK.tools.fromRoutes(securedRoutes.publicRoute),
            whoAmI: securedK.tools.fromRoutes(securedRoutes.whoAmI),
            ownerOnly: securedK.tools.fromRoutes(securedRoutes.ownerOnly),
        },
    });

    const securedContract = securedK.contract({
        routes: {
            api: securedRoutes,
        },
        tools: securedTools,
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

    const securedToolsMeta = (testRouter: Record<string, unknown>) => ({
        [TOOLS_META]: {
            tools: securedContract.tools!,
            handlers: {},
            router: testRouter,
        },
    });

    const securedRouter = {
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
    };

    const securedGuards = {
        user: ({ bearer, deny }: { bearer: { token: string } | null; deny: GuardDeny }) => {
            if (bearer?.token !== 'tok_ada') return deny(401, 'Unauthorized');
            return {
                userId: '1',
            };
        },
    };

    const makeSecuredApi = (guards: Record<string, unknown> | null = securedGuards) =>
        Object.assign(
            assembleApi(securedContract, {
                router: securedRouter,
                ...(guards === null ? {} : { guards }),
            }),
            securedToolsMeta(securedRouter)
        ) as Parameters<typeof createMcpServer>[0];

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
        const apiWithoutGuards = makeSecuredApi(null);
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

describe('instructions', () => {
    it('explains the envelope and lists the contract tag groups', () => {
        const instructions = buildInstructions(contract, toolsOffered(contract.tools), undefined);

        expect(instructions).toContain('{ status, body }');
        expect(instructions).toContain('- API');
    });

    it('appends the authored text after the generated overview', () => {
        const instructions = buildInstructions(contract, toolsOffered(contract.tools), 'Every timestamp is UTC.');

        expect(instructions.indexOf('- API')).toBeLessThan(instructions.indexOf('Every timestamp is UTC.'));
    });

    it('leaves out a group no published tool belongs to', () => {
        const instructions = buildInstructions(contract, [], undefined);

        expect(instructions).not.toContain('- API');
    });

    it('says the remaining tools answer directly when a declared one is published', () => {
        const declaredOnly = k.contract({
            routes: contractRoutes,
            tools: k.tools({
                countWords: {
                    description: 'Count the words in a piece of text',
                    input: z.object({
                        text: z.string(),
                    }),
                    output: z.object({
                        words: z.int(),
                    }),
                },
            }),
        });

        const instructions = buildInstructions(declaredOnly, toolsOffered(declaredOnly.tools), undefined);

        expect(instructions).toContain('return their own result directly');
        expect(instructions).not.toContain('{ status, body }');
    });
});
