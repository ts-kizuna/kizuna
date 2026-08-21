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
import { assertCanonicalResource, protectedResourceMetadataPath, protectedResourceMetadataUrl } from './oauth.js';

describe('protectedResourceMetadataPath', () => {
    it('appends the endpoint path to the well-known prefix', () => {
        expect(protectedResourceMetadataPath('/mcp')).toBe('/.well-known/oauth-protected-resource/mcp');
    });
});

describe('protectedResourceMetadataUrl', () => {
    it('builds the absolute URL at the origin root', () => {
        expect(
            protectedResourceMetadataUrl(
                {
                    resource: 'https://api.example.com/mcp',
                    scheme: 'user',
                },
                '/mcp'
            )
        ).toBe('https://api.example.com/.well-known/oauth-protected-resource/mcp');
    });

    it('keeps a mount prefix in front of the well-known path', () => {
        expect(
            protectedResourceMetadataUrl(
                {
                    resource: 'https://api.example.com/api/mcp',
                    scheme: 'user',
                },
                '/mcp'
            )
        ).toBe('https://api.example.com/api/.well-known/oauth-protected-resource/mcp');
    });
});

describe('assertCanonicalResource', () => {
    it('rejects a resource that does not end with the endpoint path', () => {
        expect(() =>
            assertCanonicalResource(
                {
                    resource: 'https://api.example.com',
                    scheme: 'user',
                },
                '/mcp'
            )
        ).toThrow('does not end with the endpoint path');
    });
});

const user = Kizuna.identity.oauth2({
    issuer: 'https://auth.example.com',
    flows: {
        authorizationCode: {
            authorizationUrl: 'https://auth.example.com/oauth2/authorize',
            tokenUrl: 'https://auth.example.com/oauth2/token',
            scopes: {
                'users:read': 'Read users',
                'users:write': 'Create and update users',
            },
        },
    },
    context: z.object({
        userId: z.string(),
    }),
    access: z.object({
        role: z.string(),
    }),
});

const member = Kizuna.identity.apiKey({
    name: 'x-api-key',
    in: 'header',
});

const k = new Kizuna({
    tags: Kizuna.tags({
        api: 'API',
    }),
    identities: {
        user,
        member,
    },
});

const apiRoutes = k.routes('api', {
    getUser: {
        method: 'GET',
        path: '/users/:id',
        summary: 'Get a user by id',
        responses: {
            200: z.object({
                id: z.string(),
                viewer: z.string(),
            }),
        },
    },
    createUser: {
        method: 'POST',
        path: '/users',
        summary: 'Create a user',
        body: z.object({
            name: z.string(),
        }),
        responses: {
            201: z.object({
                id: z.string(),
            }),
        },
    },
    adminReport: {
        method: 'GET',
        path: '/report',
        summary: 'Admin report',
        responses: {
            200: z.object({
                total: z.number(),
            }),
        },
    },
    memberFacts: {
        method: 'GET',
        path: '/member-facts',
        summary: 'Facts for the workspace service',
        responses: {
            200: z.object({
                ok: z.boolean(),
            }),
        },
    },
});

const contract = k.contract({
    routes: {
        api: apiRoutes,
    },
    auth: {
        api: {
            '*': 'user',
            createUser: {
                user: ['users:write'],
            },
            adminReport: {
                user: {
                    role: 'admin',
                },
            },
            memberFacts: 'member',
        },
    },
    plugins: {
        mcp: mcpPlugin({
            name: 'OAuth API',
            oauth: {
                resource: 'https://api.example.com/mcp',
                scheme: 'user',
            },
        }),
    },
});

const TOKENS: Record<string, { userId: string; role: string; granted: string[] }> = {
    reader: {
        userId: 'u-reader',
        role: 'employee',
        granted: ['users:read'],
    },
    writer: {
        userId: 'u-writer',
        role: 'employee',
        granted: ['users:read', 'users:write'],
    },
    admin: {
        userId: 'u-admin',
        role: 'admin',
        granted: ['users:read', 'users:write'],
    },
};

const makeApi = (onGuardRun?: () => void) => {
    const server = new KizunaServer(contract);
    const requireUser = server.guard('user', ({ oauth2, scopes, deny }) => {
        onGuardRun?.();
        const session = oauth2 ? TOKENS[oauth2.token] : undefined;
        if (!session) return deny(401, 'Invalid or expired token');
        if (!scopes.every((scope) => session.granted.includes(scope))) return deny(403, 'The token is missing a required scope');
        return {
            userId: session.userId,
            role: session.role,
        };
    });
    const requireMember = server.guard('member', ({ apiKey, deny }) => {
        if (apiKey?.value !== 'workspace-secret') return deny(403, 'Forbidden');
    });
    return server.api({
        guards: {
            user: requireUser,
            member: requireMember,
        },
        router: {
            api: {
                getUser: ({ params, auth }) => ({
                    status: 200,
                    body: {
                        id: params.id,
                        viewer: auth.user.userId,
                    },
                }),
                createUser: () => ({
                    status: 201,
                    body: {
                        id: 'u-new',
                    },
                }),
                adminReport: () => ({
                    status: 200,
                    body: {
                        total: 3,
                    },
                }),
                memberFacts: () => ({
                    status: 200,
                    body: {
                        ok: true,
                    },
                }),
            },
        },
        plugins: {
            mcp: mcpPluginServer(),
        },
    });
};

describe('mcpPlugin: oauth', () => {
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

    const start = async (onGuardRun?: () => void): Promise<number> => {
        const app = express();
        app.use(express.json());
        makeApi(onGuardRun).mount(app);
        return new Promise((resolve) => {
            const listening = app.listen(0, () => {
                running = listening;
                resolve((listening.address() as { port: number }).port);
            });
        });
    };

    const connect = async (port: number, token: string) => {
        const connected = new Client({
            name: 'test-client',
            version: '1.0.0',
        });
        await connected.connect(
            new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
                requestInit: {
                    headers: {
                        authorization: `Bearer ${token}`,
                    },
                },
            })
        );
        client = connected;
        return connected;
    };

    const jsonRpc = (port: number, token: string | undefined, body: unknown) =>
        fetch(`http://127.0.0.1:${port}/mcp`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                accept: 'application/json, text/event-stream',
                ...(token === undefined
                    ? {}
                    : {
                          authorization: `Bearer ${token}`,
                      }),
            },
            body: JSON.stringify(body),
        });

    const toolCall = (name: string, callArguments: Record<string, unknown>) => ({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
            name,
            arguments: callArguments,
        },
    });

    it('serves the metadata document without auth', async () => {
        const port = await start();
        const response = await fetch(`http://127.0.0.1:${port}/.well-known/oauth-protected-resource/mcp`);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            resource: 'https://api.example.com/mcp',
            authorization_servers: ['https://auth.example.com'],
            scopes_supported: ['users:read', 'users:write'],
            bearer_methods_supported: ['header'],
        });
    });

    it('answers a missing token with 401 and the discovery challenge', async () => {
        const port = await start();
        const response = await jsonRpc(port, undefined, {});
        expect(response.status).toBe(401);
        const challenge = response.headers.get('www-authenticate')!;
        expect(challenge).toContain('resource_metadata="https://api.example.com/.well-known/oauth-protected-resource/mcp"');
        expect(challenge).toContain('scope="users:read users:write"');
        expect(challenge).not.toContain('error=');
        expect(response.headers.get('content-type')).toContain('application/problem+json');
        expect(((await response.json()) as { status: number }).status).toBe(401);
    });

    it('answers a bad token with 401 and invalid_token', async () => {
        const port = await start();
        const response = await jsonRpc(port, 'garbage', {});
        expect(response.status).toBe(401);
        expect(response.headers.get('www-authenticate')).toContain('error="invalid_token"');
    });

    it('runs tools with a valid token, guard once per request, context in the handler', async () => {
        let guardRuns = 0;
        const port = await start(() => {
            guardRuns += 1;
        });
        const connected = await connect(port, 'reader');

        guardRuns = 0;
        const result = await connected.callTool({
            name: 'api_get_user',
            arguments: {
                params: {
                    id: '42',
                },
            },
        });
        expect(guardRuns).toBe(1);

        const content = result.content as Array<{ text: string }>;
        const parsed = JSON.parse(content[0]!.text);
        expect(parsed.status).toBe(200);
        expect(parsed.body).toEqual({
            id: '42',
            viewer: 'u-reader',
        });
    });

    it('answers a scope shortfall with 403 and insufficient_scope', async () => {
        const port = await start();
        const response = await jsonRpc(
            port,
            'reader',
            toolCall('api_create_user', {
                body: {
                    name: 'Ada',
                },
            })
        );
        expect(response.status).toBe(403);
        const challenge = response.headers.get('www-authenticate')!;
        expect(challenge).toContain('error="insufficient_scope"');
        expect(challenge).toContain('scope="users:write"');
        expect(challenge).toContain('resource_metadata="https://api.example.com/.well-known/oauth-protected-resource/mcp"');
    });

    it('runs a tool the token has the scopes for', async () => {
        const port = await start();
        const connected = await connect(port, 'writer');
        const result = await connected.callTool({
            name: 'api_create_user',
            arguments: {
                body: {
                    name: 'Ada',
                },
            },
        });
        const parsed = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
        expect(parsed.status).toBe(201);
    });

    it('answers an access-gate failure with a plain 403', async () => {
        const port = await start();
        const response = await jsonRpc(port, 'writer', toolCall('api_admin_report', {}));
        expect(response.status).toBe(403);
        expect(response.headers.get('www-authenticate')).toBeNull();
    });

    it('passes an access gate the token satisfies', async () => {
        const port = await start();
        const connected = await connect(port, 'admin');
        const result = await connected.callTool({
            name: 'api_admin_report',
            arguments: {},
        });
        const parsed = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
        expect(parsed.status).toBe(200);
    });

    it('keeps in-band denials for schemes other than the oauth one', async () => {
        const port = await start();
        const connected = await connect(port, 'writer');
        const result = await connected.callTool({
            name: 'api_member_facts',
            arguments: {},
        });
        expect(result.isError).toBe(true);
        const parsed = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
        expect(parsed.status).toBe(403);
    });
});

describe('mcpPlugin: oauth declaration', () => {
    it('declares the metadata route only when oauth is configured', () => {
        expect(Object.keys(mcpPlugin({}).routes)).toEqual(['endpoint']);
        expect(
            Object.keys(
                mcpPlugin({
                    oauth: {
                        resource: 'https://api.example.com/mcp',
                        scheme: 'user',
                    },
                }).routes
            )
        ).toEqual(['endpoint', 'protectedResourceMetadata']);
    });

    it('accepts any resource at declaration time, so contracts evaluate without deployment env', () => {
        expect(() =>
            mcpPlugin({
                oauth: {
                    resource: 'undefined/mcp',
                    scheme: 'user',
                },
            })
        ).not.toThrow();
    });

    it('rejects an invalid resource when the server half serves it', () => {
        const brokenContract = k.contract({
            routes: {
                api: apiRoutes,
            },
            auth: {
                api: 'user',
            },
            plugins: {
                mcp: mcpPlugin({
                    oauth: {
                        resource: '/mcp',
                        scheme: 'user',
                    },
                }),
            },
        });
        const server = new KizunaServer(brokenContract);
        const requireUser = server.guard('user', () => ({
            userId: 'u',
            role: 'employee',
        }));
        const requireMember = server.guard('member', () => undefined);
        expect(() =>
            server.api({
                guards: {
                    user: requireUser,
                    member: requireMember,
                },
                router: {
                    api: {
                        getUser: () => ({
                            status: 200,
                            body: {
                                id: '1',
                                viewer: 'u',
                            },
                        }),
                        createUser: () => ({
                            status: 201,
                            body: {
                                id: '1',
                            },
                        }),
                        adminReport: () => ({
                            status: 200,
                            body: {
                                total: 0,
                            },
                        }),
                        memberFacts: () => ({
                            status: 200,
                            body: {
                                ok: true,
                            },
                        }),
                    },
                },
                plugins: {
                    mcp: mcpPluginServer(),
                },
            })
        ).toThrow('not an absolute URI');
    });
});
