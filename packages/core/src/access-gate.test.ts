import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createAdapter, type AdapterRequest, type AdapterResult, type GuardMap } from './adapter.js';
import { Kizuna } from './kizuna.js';
import type { Method, RouteDefinition, Routes } from './types.js';

const member = Kizuna.identity.apiKey({
    name: 'x-workspace-token',
    in: 'header',
    context: z.object({
        workspaceUserId: z.string(),
    }),
    access: z.object({
        role: z.enum(['owner', 'admin']),
    }),
});

const user = Kizuna.identity.bearer({
    context: z.object({
        userId: z.string(),
    }),
});

const k = new Kizuna({
    identities: {
        user,
        member,
    },
});

const routes = {
    workspace: k.routes({
        getWorkspace: {
            method: 'GET',
            path: '/workspace',
            responses: {
                200: z.object({
                    ok: z.boolean(),
                }),
            },
        },
        deleteWorkspace: {
            method: 'DELETE',
            path: '/workspace',
            responses: {
                200: z.object({
                    ok: z.boolean(),
                }),
            },
        },
    }),
    members: k.routes({
        listMembers: {
            method: 'GET',
            path: '/workspace/members',
            responses: {
                200: z.object({
                    ok: z.boolean(),
                }),
            },
        },
        inviteMember: {
            method: 'POST',
            path: '/workspace/members',
            responses: {
                200: z.object({
                    ok: z.boolean(),
                }),
            },
        },
    }),
};

const contract = k.contract({
    routes,
    auth: {
        workspace: {
            '*': 'member',
            deleteWorkspace: {
                member: {
                    role: 'owner',
                },
            },
        },
        members: {
            '*': 'user',
            inviteMember: {
                member: {
                    role: ['owner', 'admin'],
                },
            },
        },
    },
});

const okHandler = () => ({
    status: 200 as const,
    body: {
        ok: true,
    },
});

const router = {
    workspace: {
        getWorkspace: okHandler,
        deleteWorkspace: okHandler,
    },
    members: {
        listMembers: okHandler,
        inviteMember: okHandler,
    },
};

const makeRequest = (method: Method, path: string, headers: Record<string, string> = {}): AdapterRequest<null> => ({
    request: null,
    method,
    resolution: {
        kind: 'core-match',
        path,
    },
    query: {},
    headers,
    readBody: () => undefined,
});

const makeAdapter = () => {
    const results: AdapterResult[] = [];
    const adapter = createAdapter<null, void, Record<string, never>>({
        buildHandlerContext: () => ({}),
        respond: (result) => {
            results.push(result);
        },
    });
    return { adapter, results };
};

/**
 * Guards that authenticate and nothing more. Every allow/deny below is the
 * framework's, never the guard's.
 */
const memberGuardForRole = (role: string | undefined) =>
    ({
        member: ({ apiKey, unauthenticated }) => {
            if (!apiKey || role === undefined) return unauthenticated();
            return {
                workspaceUserId: 'wsu_1',
                role,
            };
        },
        user: ({ bearer, unauthenticated }) => {
            if (!bearer) return unauthenticated();
            return {
                userId: 'u_1',
            };
        },
    }) as GuardMap<Record<string, never>>;

const OWNER_TOKEN = {
    'x-workspace-token': 'wst_owner',
};
const ADMIN_TOKEN = {
    'x-workspace-token': 'wst_admin',
};

const call = async (options: {
    method: Method;
    path: string;
    headers?: Record<string, string>;
    role?: string;
    routes?: Routes;
    router?: unknown;
}) => {
    const { adapter, results } = makeAdapter();
    await adapter.handle({
        routes: (options.routes ?? contract.routes) as Routes,
        router: (options.router ?? router) as never,
        request: makeRequest(options.method, options.path, options.headers),
        responseContext: {},
        guards: memberGuardForRole(options.role),
        schemes: contract.securitySchemes,
    });
    return results[0];
};

const statusOf = (result: AdapterResult | undefined) => (result as { status?: number } | undefined)?.status;

describe('access gate enforcement', () => {
    it('denies an admin on an owner-only route with 403', async () => {
        const result = await call({
            method: 'DELETE',
            path: '/workspace',
            headers: ADMIN_TOKEN,
            role: 'admin',
        });
        expect(result?.kind).toBe('guard-denied');
        expect(statusOf(result)).toBe(403);
        expect((result as { detail: string }).detail).toContain('member.role');
    });

    it('allows an owner on an owner-only route', async () => {
        const result = await call({
            method: 'DELETE',
            path: '/workspace',
            headers: OWNER_TOKEN,
            role: 'owner',
        });
        expect(result?.kind).toBe('success');
    });

    it('allows an admin where the gate lists both roles', async () => {
        const result = await call({
            method: 'POST',
            path: '/workspace/members',
            headers: {
                ...ADMIN_TOKEN,
                authorization: 'Bearer tok',
            },
            role: 'admin',
        });
        expect(result?.kind).toBe('success');
    });

    it('denies a role outside an array gate with 403', async () => {
        const result = await call({
            method: 'POST',
            path: '/workspace/members',
            headers: {
                'x-workspace-token': 'wst_viewer',
                authorization: 'Bearer tok',
            },
            role: 'viewer',
        });
        expect(result?.kind).toBe('guard-denied');
        expect(statusOf(result)).toBe(403);
    });

    it('allows any member on a route the wildcard covers and no override narrows', async () => {
        const result = await call({
            method: 'GET',
            path: '/workspace',
            headers: ADMIN_TOKEN,
            role: 'admin',
        });
        expect(result?.kind).toBe('success');
    });

    it('does not let the wildcard satisfy an owner-only override', async () => {
        const wildcardRoute = await call({
            method: 'GET',
            path: '/workspace',
            headers: ADMIN_TOKEN,
            role: 'admin',
        });
        const overriddenRoute = await call({
            method: 'DELETE',
            path: '/workspace',
            headers: ADMIN_TOKEN,
            role: 'admin',
        });
        expect(wildcardRoute?.kind).toBe('success');
        expect(overriddenRoute?.kind).toBe('guard-denied');
    });

    it('separates an identity failure from an authorization failure by status', async () => {
        const noCredential = await call({
            method: 'DELETE',
            path: '/workspace',
            role: undefined,
        });
        const insufficientRole = await call({
            method: 'DELETE',
            path: '/workspace',
            headers: ADMIN_TOKEN,
            role: 'admin',
        });
        expect(statusOf(noCredential)).toBe(401);
        expect(statusOf(insufficientRole)).toBe(403);
        expect(statusOf(noCredential)).not.toBe(statusOf(insufficientRole));
        expect((insufficientRole as { detail: string }).detail).toContain('member.role');
    });

    it('gives an unauthenticated caller the guard status and an under-privileged one the gate 403', async () => {
        const unauthenticated = await call({
            method: 'POST',
            path: '/workspace/members',
            role: 'admin',
        });
        const underPrivileged = await call({
            method: 'POST',
            path: '/workspace/members',
            headers: {
                'x-workspace-token': 'wst_viewer',
                authorization: 'Bearer tok',
            },
            role: 'viewer',
        });
        // `members` runs the `user` guard first, which denies 401 with no bearer.
        expect(statusOf(unauthenticated)).toBe(401);
        expect(statusOf(underPrivileged)).toBe(403);
        expect(statusOf(unauthenticated)).not.toBe(statusOf(underPrivileged));
    });

    it('denies a gated route when the guard result omits the gated field', async () => {
        const { adapter, results } = makeAdapter();
        await adapter.handle({
            routes: contract.routes as Routes,
            router: router as never,
            request: makeRequest('DELETE', '/workspace', OWNER_TOKEN),
            responseContext: {},
            guards: {
                member: () => ({
                    workspaceUserId: 'wsu_1',
                }),
            } as unknown as GuardMap<Record<string, never>>,
            schemes: contract.securitySchemes,
        });
        expect(results[0]?.kind).toBe('guard-denied');
        expect(statusOf(results[0])).toBe(403);
    });
});

/**
 * A group the auth map omits keeps `security: undefined`, so no guard runs. The
 * type layer rejects the omission; these pin what the runtime does without it.
 */
describe('a route with no auth-map entry', () => {
    const undeclared = {
        undeclared: k.routes({
            secret: {
                method: 'GET',
                path: '/undeclared',
                responses: {
                    200: z.object({
                        ok: z.boolean(),
                    }),
                },
            },
        }),
    };
    const undeclaredContract = k.contract({
        routes: undeclared,
        // Cast past the type layer to reach the runtime behavior under test.
        auth: {} as never,
    });

    it('leaves the route unsecured rather than denying it', async () => {
        const route = (undeclaredContract.routes.undeclared as unknown as Record<string, RouteDefinition>).secret;
        expect(route?.security).toBeUndefined();

        const result = await call({
            method: 'GET',
            path: '/undeclared',
            routes: undeclaredContract.routes as unknown as Routes,
            router: {
                undeclared: {
                    secret: okHandler,
                },
            },
        });
        // Fails open. Flip to 'guard-denied' if the runtime learns to reject this.
        expect(result?.kind).toBe('success');
    });
});

describe('a guard that returns no object', () => {
    const gated = k.contract({
        routes: {
            workspace: k.routes({
                deleteWorkspace: {
                    method: 'DELETE',
                    path: '/workspace',
                    responses: {
                        200: z.object({
                            ok: z.boolean(),
                        }),
                    },
                },
            }),
        },
        auth: {
            workspace: {
                member: {
                    role: 'owner',
                },
            },
        },
    });

    it('is denied by a gate it returned nothing to satisfy', async () => {
        const { adapter, results } = makeAdapter();
        await adapter.handle({
            routes: gated.routes as Routes,
            router: {
                workspace: {
                    deleteWorkspace: okHandler,
                },
            } as never,
            request: makeRequest('DELETE', '/workspace', OWNER_TOKEN),
            responseContext: {},
            guards: {
                member: () => undefined,
            } as unknown as GuardMap<Record<string, never>>,
            schemes: gated.securitySchemes,
        });
        expect(results[0]?.kind).toBe('guard-denied');
        expect(statusOf(results[0])).toBe(403);
    });
});
