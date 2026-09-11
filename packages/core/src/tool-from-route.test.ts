import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Kizuna } from './kizuna.js';
import { toolRunnerFrom } from './adapter.js';
import { ToolIdentityError, type ToolRunner } from './tool-runner.js';

const k = new Kizuna({
    identities: {
        member: Kizuna.identity.apiKey({
            name: 'x-workspace-token',
            in: 'header',
            context: z.object({
                workspaceId: z.string(),
            }),
            access: z.object({
                role: z.enum(['owner', 'admin']),
            }),
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

const tools = k.tools({
    users: {
        find: k.tools.fromRoute(routes.users.getUser),
        remove: k.tools.fromRoute(routes.users.deleteUser, {
            description: 'Permanently remove a user. There is no undo.',
        }),
    },
});

const contract = k.contract({
    routes,
    tools,
    auth: {
        users: {
            '*': false,
            deleteUser: {
                member: {
                    role: 'owner',
                },
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

/**
 * Typed against this contract's own tools, the way a handler receives it. The
 * adapter's own `toolRunnerFrom` is erased, because it runs before any one
 * contract is in view.
 */
const runner = () =>
    toolRunnerFrom({
        tools: contract.tools!,
        handlers: {},
        router: router as unknown as Record<string, unknown>,
    }) as unknown as ToolRunner<typeof tools>;

describe('k.tools.fromRoute', () => {
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
        const bound = runner().as({
            member: {
                workspaceId: 'w_1',
                role: 'owner',
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

    it('refuses a caller whose identity fails the route access gate', async () => {
        const bound = runner().as({
            member: {
                workspaceId: 'w_1',
                role: 'admin',
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
        expect(outcome.ok === false && outcome.message).toContain('member.role');
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
                tools: k.tools({
                    ping: k.tools.fromRoute(stray.other.ping),
                }),
                auth: {
                    users: false,
                },
            })
        ).toThrow(/not on this contract/);
    });
});

describe('the builder form', () => {
    it('builds the same tree as naming the helper in full', () => {
        const viaBuilder = k.tools(({ fromRoute }) => ({
            users: {
                find: fromRoute(routes.users.getUser),
            },
        }));

        const viaHelper = k.tools({
            users: {
                find: k.tools.fromRoute(routes.users.getUser),
            },
        });

        expect(viaBuilder.users.find.definition.description).toBe(viaHelper.users.find.definition.description);
        expect(viaBuilder.users.find.definition.title).toBe(viaHelper.users.find.definition.title);
        expect(viaBuilder.users.find.definition.annotations).toEqual(viaHelper.users.find.definition.annotations);
        expect(z.toJSONSchema(viaBuilder.users.find.input!, { io: 'input' })).toEqual(
            z.toJSONSchema(viaHelper.users.find.input!, { io: 'input' })
        );
        expect(viaBuilder.users.find.route).toBe(routes.users.getUser);
    });

});
