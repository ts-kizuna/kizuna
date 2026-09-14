import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Kizuna } from './kizuna.js';
import { toolRunnerFrom } from './adapter.js';
import { bindToolRunner, ToolIdentityError, type ToolRunner } from './tool-runner.js';

const k = new Kizuna({
    identities: {
        member: Kizuna.identity.apiKey({
            name: 'x-workspace-token',
            in: 'header',
            context: z.object({
                workspaceId: z.string(),
            }),
            roles: Kizuna.roles(['owner', 'admin']),
        }),
    },
});

const routes = k.routes({
    users: {
        getUser: {
            method: 'GET',
            path: '/users/:id',
            responses: {
                200: z.object({
                    id: z.string(),
                    name: z.string(),
                }),
                404: z.object({
                    detail: z.string(),
                }),
            },
            summary: 'Fetch one user',
        },
        deleteUser: {
            method: 'DELETE',
            path: '/users/:id',
            responses: {
                204: z.void(),
            },
        },
    },
});

const tools = k.tools(({ toolFromRoutes }) => ({
    users: {
        find: toolFromRoutes(routes.users.getUser),
        remove: toolFromRoutes(routes.users.deleteUser, {
            description: 'Permanently remove a user. There is no undo.',
        }),
    },
}));

const contract = k.contract({
    routes,
    tools,
    accessControl: {
        users: {
            '*': false,
            deleteUser: {
                auth: 'member',
                roles: 'owner',
            },
        },
    },
});

const router = {
    users: {
        getUser: ({ params }: { params: { id: string } }) =>
            params.id === '404'
                ? {
                      status: 404,
                      body: {
                          detail: 'No user with that id',
                      },
                  }
                : {
                      status: 200,
                      body: {
                          id: params.id,
                          name: 'Ada',
                      },
                  },
        deleteUser: () => ({
            status: 204,
            body: undefined,
        }),
    },
};

const runner = () =>
    toolRunnerFrom({
        tools: contract.tools!,
        handlers: {},
        router: router as unknown as Record<string, unknown>,
    }) as unknown as ToolRunner<typeof tools>;

describe('toolFromRoutes', () => {
    it('derives the description from the route, and says which call it makes', () => {
        const definition = runner().definitions.find((tool) => tool.name === 'users_find');
        expect(definition?.description).toBe('Fetch one user\n\nHTTP: GET /users/:id');
    });

    it('derives annotations from the method, per RFC 9110', () => {
        const found = runner().definitions.find((tool) => tool.name === 'users_find');
        const removed = runner().definitions.find((tool) => tool.name === 'users_remove');

        expect(found?.annotations).toEqual({
            readOnlyHint: true,
            idempotentHint: true,
        });
        expect(removed?.annotations).toEqual({
            idempotentHint: true,
            destructiveHint: true,
        });
    });

    it('takes an authored description over the route summary', () => {
        const removed = runner().definitions.find((tool) => tool.name === 'users_remove');
        expect(removed?.description).toBe('Permanently remove a user. There is no undo.');
    });

    it('nests path params so nothing can collide with a query field', () => {
        const definition = runner().definitions.find((tool) => tool.name === 'users_find');
        expect(definition?.inputSchema.properties).toHaveProperty('params');
    });

    it('runs the route behind it and answers the envelope', async () => {
        await expect(
            runner().dispatch({
                id: 'call_1',
                name: 'users.find',
                input: {
                    params: {
                        id: '7',
                    },
                },
            })
        ).resolves.toEqual({
            ok: true,
            id: 'call_1',
            name: 'users.find',
            output: {
                status: 200,
                body: {
                    id: '7',
                    name: 'Ada',
                },
            },
        });
    });

    it('carries a failing status through the envelope rather than throwing', async () => {
        const outcome = await runner().dispatch({
            id: 'call_1',
            name: 'users.find',
            input: {
                params: {
                    id: '404',
                },
            },
        });

        expect(outcome).toMatchObject({
            ok: true,
            output: {
                status: 404,
            },
        });
    });

    it('refuses a route whose identity the caller does not carry', async () => {
        await expect(
            runner().users.remove.run({
                params: {
                    id: '7',
                },
            })
        ).rejects.toBeInstanceOf(ToolIdentityError);
    });

    it('runs it once that identity is bound', async () => {
        const bound = bindToolRunner(runner(), {
            auth: {
                member: {
                    workspaceId: 'w_1',
                    role: 'owner',
                },
            },
        });

        await expect(
            bound.users.remove.run({
                params: {
                    id: '7',
                },
            })
        ).resolves.toEqual({
            status: 204,
        });
    });

    it('refuses a caller whose role the route does not accept', async () => {
        const bound = bindToolRunner(runner(), {
            auth: {
                member: {
                    workspaceId: 'w_1',
                    role: 'admin',
                },
            },
        });

        const outcome = await bound.dispatch({
            name: 'users.remove',
            input: {
                params: {
                    id: '7',
                },
            },
        });

        expect(outcome.ok).toBe(false);
        expect(outcome.ok === false && outcome.message).toContain('owner');
    });

    it('names the route when it is not on the contract', () => {
        const stray = k.routes({
            other: {
                ping: {
                    method: 'GET',
                    path: '/ping',
                    responses: {
                        200: z.object({ ok: z.boolean() }),
                    },
                },
            },
        });

        expect(() =>
            k.contract({
                routes,
                tools: k.tools(({ toolFromRoutes }) => ({
                    ping: toolFromRoutes(stray.other.ping),
                })),
                accessControl: {
                    users: false,
                },
            })
        ).toThrow(/not on this contract/);
    });
});

describe('toolFromRoutes, given a group', () => {
    const group = k.routes({
        users: {
            getUser: {
                method: 'GET',
                path: '/users/:id',
                summary: 'Fetch one user',
                responses: {
                    200: z.object({
                        id: z.string(),
                    }),
                },
            },
            exportUsers: {
                method: 'GET',
                path: '/users/export',
                summary: 'Export users',
                responses: {
                    200: z.object({
                        url: z.string(),
                    }),
                },
            },
            avatar: {
                method: 'POST',
                path: '/users/:id/avatar',
                contentType: 'multipart/form-data',
                body: z.object({
                    file: z.string(),
                }),
                responses: {
                    200: z.object({
                        size: z.int(),
                    }),
                },
            },
            watch: {
                method: 'GET',
                path: '/users/watch',
                responses: {
                    200: {
                        stream: {
                            tick: z.object({
                                at: z.string(),
                            }),
                        },
                    },
                },
            },
        },
    });

    it('takes every route in the group', () => {
        const built = k.tools(({ toolFromRoutes }) => ({
            users: toolFromRoutes(group.users),
        }));

        expect(Object.keys(built.users)).toEqual(['getUser', 'exportUsers']);
    });

    it('leaves out the routes that cannot be tools', () => {
        const built = k.tools(({ toolFromRoutes }) => ({
            users: toolFromRoutes(group.users),
        }));

        expect(built.users).not.toHaveProperty('avatar');
        expect(built.users).not.toHaveProperty('watch');
    });

    it('drops the ones set to false', () => {
        const built = k.tools(({ toolFromRoutes }) => ({
            users: toolFromRoutes(group.users, {
                exportUsers: false,
            }),
        }));

        expect(Object.keys(built.users)).toEqual(['getUser']);
    });

    it('gives one of them different words without naming it twice', () => {
        const built = k.tools(({ toolFromRoutes }) => ({
            users: toolFromRoutes(group.users, {
                getUser: {
                    description: 'Look a person up by id.',
                },
            }),
        }));

        expect(built.users.getUser.definition.description).toBe('Look a person up by id.');
        expect(built.users.exportUsers.definition.description).toContain('Export users');
    });
});
