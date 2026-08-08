import { z } from 'zod';
import { ProblemDetailsSchema } from '../error-response.js';
import { createIdentity } from '../identity.js';
import { kizuna } from '../kizuna.js';
import { createTags } from '../tags.js';
import type { Router } from '../handler-pipeline.js';
import type { GuardDeny } from '../adapter.js';

const { k } = kizuna({
    tags: createTags({
        api: 'API',
    }),
});

export interface User {
    id: string;
    name: string;
    email: string;
}

/**
 * The user CRUD group the express, hono, fastify and next suites each defined by hand.
 *
 * Module level rather than a factory so `k.routes` infers `method` and `path` as literals; a factory returning an object
 * literal widens both to `string` and weakens `PathParamsCheck`.
 */
export const userRoutes = k.routes('api', {
    getUser: {
        method: 'GET',
        path: '/users/:id',
        responses: {
            200: z.object({
                id: z.string(),
                name: z.string(),
            }),
            404: ProblemDetailsSchema,
        },
    },
    createUser: {
        method: 'POST',
        path: '/users',
        body: z.object({
            name: z.string().min(1),
            email: z.email(),
        }),
        responses: {
            201: z.object({
                id: z.string(),
                name: z.string(),
                email: z.string(),
            }),
        },
    },
    listUsers: {
        method: 'GET',
        path: '/users',
        query: z.object({
            page: z.number().int().min(1).default(1),
            limit: z.number().int().min(1).default(10),
        }),
        responses: {
            200: z.object({
                users: z.array(
                    z.object({
                        id: z.string(),
                        name: z.string(),
                    })
                ),
                total: z.number(),
            }),
        },
    },
    deleteUser: {
        method: 'DELETE',
        path: '/users/:id',
        responses: {
            200: z.object({
                success: z.boolean(),
            }),
            404: ProblemDetailsSchema,
        },
    },
});

export type UserRoutes = typeof userRoutes;

export const userContract = k.contract({
    routes: userRoutes,
});

/**
 * Generic in the handler context so each adapter gets a typed `Router<UserRoutes, Context>` with no cast.
 */
export const createUserRouter = <Context>(): Router<UserRoutes, Context> => {
    const users = new Map<string, User>();
    let nextId = 1;
    return {
        getUser: ({ params }) => {
            const user = users.get(params.id);
            if (!user) {
                return {
                    status: 404,
                    body: {
                        detail: 'Not found',
                    },
                };
            }
            return {
                status: 200,
                body: {
                    id: user.id,
                    name: user.name,
                },
            };
        },
        createUser: ({ body }) => {
            const id = String(nextId++);
            const user: User = {
                id,
                name: body.name,
                email: body.email,
            };
            users.set(id, user);
            return {
                status: 201,
                body: user,
            };
        },
        listUsers: ({ query }) => {
            const all = Array.from(users.values());
            const start = (query.page - 1) * query.limit;
            return {
                status: 200,
                body: {
                    users: all.slice(start, start + query.limit).map((user) => ({
                        id: user.id,
                        name: user.name,
                    })),
                    total: all.length,
                },
            };
        },
        deleteUser: ({ params }) => {
            if (!users.has(params.id)) {
                return {
                    status: 404,
                    body: {
                        detail: 'Not found',
                    },
                };
            }
            users.delete(params.id);
            return {
                status: 200,
                body: {
                    success: true,
                },
            };
        },
    };
};

/**
 * A route whose handler returns a body the contract does not allow, for `responses.validation`.
 */
export const brokenRoutes = k.routes('api', {
    getBroken: {
        method: 'GET',
        path: '/broken',
        responses: {
            200: z.object({
                id: z.string(),
            }),
        },
    },
});

export const brokenContract = k.contract({
    routes: brokenRoutes,
});

export const createBrokenRouter = <Context>(): Router<typeof brokenRoutes, Context> => ({
    getBroken: () => ({
        status: 200,
        body: {
            id: 42 as unknown as string,
        },
    }),
});

export const sessionToken = 'tok_ada';

/**
 * The `Authorization` value the guard features send. Every adapter matches on this, so it is written once here rather
 * than hardcoded per adapter.
 */
export const sessionAuthorization = `Bearer ${sessionToken}`;

export const userIdentity = createIdentity.bearer({
    context: z.object({
        userId: z.string(),
    }),
});

export const memberIdentity = createIdentity.apiKey({
    name: 'x-workspace-token',
    in: 'header',
    context: z.object({
        workspaceUserId: z.string(),
    }),
    access: z.object({
        role: z.enum(['owner', 'admin']),
    }),
});

export const ownerToken = 'wst_owner';
export const adminToken = 'wst_admin';

const { k: securedK } = kizuna({
    identities: {
        user: userIdentity,
        member: memberIdentity,
    },
});

export const securedRoutes = securedK.routes({
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
    both: {
        method: 'GET',
        path: '/both',
        responses: {
            200: z.object({
                userId: z.string(),
                workspaceUserId: z.string(),
            }),
        },
    },
});

export const securedContract = securedK.contract({
    routes: {
        api: securedRoutes,
    },
    auth: {
        api: {
            '*': false,
            whoAmI: 'user',
            ownerOnly: {
                member: {
                    role: 'owner',
                },
            },
            both: {
                user: true,
                member: true,
            },
        },
    },
});

/**
 * The guard body every adapter shares. `server.guard` is an identity function in all four, so only the wiring differs.
 */
export const requireUserGuard = ({ bearer, deny }: { bearer?: { token: string }; deny: GuardDeny }) => {
    if (bearer?.token !== sessionToken) return deny(401, 'Unauthorized');
    return {
        userId: '1',
    };
};

const memberships = new Map<string, { workspaceUserId: string; role: 'owner' | 'admin' }>([
    [ownerToken, { workspaceUserId: '1', role: 'owner' }],
    [adminToken, { workspaceUserId: '2', role: 'admin' }],
]);

export const requireMemberGuard = ({ apiKey, deny }: { apiKey?: { value: string } | null; deny: GuardDeny }) => {
    const membership = apiKey ? memberships.get(apiKey.value) : undefined;
    if (!membership) return deny(403, 'Forbidden');
    return membership;
};

/**
 * The guard bodies the `guards.*` features mount, keyed by identity name.
 */
export const securedGuards = {
    user: requireUserGuard,
    member: requireMemberGuard,
};

/**
 * Typed through `HandlersFromAuth` rather than `Router`, so `auth` comes from the contract's resolved `security` and the
 * handlers below need no casts.
 */
export type SecuredRouter<Context> = Router<typeof securedContract.routes, Context>;

export const createSecuredRouter = <Context>(): SecuredRouter<Context> => ({
    api: {
        publicRoute: () => ({
            status: 200,
            body: {
                ok: true,
            },
        }),
        whoAmI: ({ auth }) => ({
            status: 200,
            body: {
                userId: auth.user.userId,
            },
        }),
        ownerOnly: () => ({
            status: 200,
            body: {
                ok: true,
            },
        }),
        both: ({ auth }) => ({
            status: 200,
            body: {
                userId: auth.user.userId,
                workspaceUserId: auth.member.workspaceUserId,
            },
        }),
    },
});

/**
 * A one-route group at a distinct path, for the sub-router composition tests each adapter repeated.
 */
export const subUserRoutes = k.routes('api', {
    getUser: {
        method: 'GET',
        path: '/sub-users/:id',
        responses: {
            200: z.object({
                id: z.string(),
            }),
        },
    },
});

export const subUserContract = k.contract({
    routes: {
        users: subUserRoutes,
    },
});

export const createSubUserRouter = <Context>(): Router<typeof subUserContract.routes, Context> => ({
    users: {
        getUser: ({ params }) => ({
            status: 200,
            body: {
                id: params.id,
            },
        }),
    },
});

/**
 * Constraints covering each Zod issue code the kernel serializes, so every adapter proves it surfaces them.
 */
export const issueRoutes = k.routes('api', {
    createProfile: {
        method: 'POST',
        path: '/profiles',
        body: z
            .object({
                name: z.string().min(1),
                age: z.number().max(120),
                tags: z.array(z.string()).max(2),
                slug: z.string().refine((value) => !value.includes(' '), 'no spaces'),
                nickname: z.string().optional(),
            })
            .refine((value) => value.name !== value.slug, 'name and slug must differ'),
        responses: {
            201: z.object({
                id: z.string(),
            }),
        },
    },
});

export const issueContract = k.contract({
    routes: issueRoutes,
});

export const createIssueRouter = <Context>(): Router<typeof issueRoutes, Context> => ({
    createProfile: () => ({
        status: 201,
        body: {
            id: '1',
        },
    }),
});

/**
 * Routes declaring non-JSON and empty response bodies.
 */
export const responseShapeRoutes = k.routes('api', {
    exportCsv: {
        method: 'GET',
        path: '/items.csv',
        responses: {
            200: {
                body: z.string(),
                contentType: 'text/csv',
            },
        },
    },
    downloadBadge: {
        method: 'GET',
        path: '/badge',
        responses: {
            200: {
                body: z.instanceof(Uint8Array),
                contentType: 'application/octet-stream',
            },
        },
    },
    deleteItem: {
        method: 'DELETE',
        path: '/items/:id',
        responses: {
            204: z.void(),
        },
    },
    createValidated: {
        method: 'POST',
        path: '/validated',
        body: z.object({
            name: z.string().min(1),
        }),
        responses: {
            201: z.object({
                id: z.string(),
            }),
        },
    },
});

export const responseShapeContract = k.contract({
    routes: responseShapeRoutes,
});

export const csvBody = 'id,name\n1,Ada';
export const badgeBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

export const createResponseShapeRouter = <Context>(): Router<typeof responseShapeRoutes, Context> => ({
    exportCsv: () => ({
        status: 200,
        body: csvBody,
    }),
    downloadBadge: () => ({
        status: 200,
        body: badgeBytes,
    }),
    deleteItem: () => ({
        status: 204,
        body: undefined,
    }),
    createValidated: () => ({
        status: 201,
        body: {
            id: '1',
        },
    }),
});

/**
 * One route per HTTP method, so every adapter proves it registers and dispatches all of them.
 */
export const methodRoutes = k.routes('api', {
    getItem: {
        method: 'GET',
        path: '/items/:id',
        responses: {
            200: z.object({
                method: z.string(),
            }),
        },
    },
    createItem: {
        method: 'POST',
        path: '/items',
        responses: {
            200: z.object({
                method: z.string(),
            }),
        },
    },
    replaceItem: {
        method: 'PUT',
        path: '/items/:id',
        responses: {
            200: z.object({
                method: z.string(),
            }),
        },
    },
    patchItem: {
        method: 'PATCH',
        path: '/items/:id',
        responses: {
            200: z.object({
                method: z.string(),
            }),
        },
    },
    deleteItem: {
        method: 'DELETE',
        path: '/items/:id',
        responses: {
            200: z.object({
                method: z.string(),
            }),
        },
    },
    optionsItem: {
        method: 'OPTIONS',
        path: '/items/:id',
        responses: {
            200: z.object({
                method: z.string(),
            }),
        },
    },
    headItem: {
        method: 'HEAD',
        path: '/items/:id',
        responses: {
            200: z.object({
                method: z.string(),
            }),
        },
    },
});

export const methodContract = k.contract({
    routes: methodRoutes,
});

export const createMethodRouter = <Context>(): Router<typeof methodRoutes, Context> => {
    const echo = (method: string) => () => ({
        status: 200 as const,
        body: {
            method,
        },
    });
    return {
        getItem: echo('GET'),
        createItem: echo('POST'),
        replaceItem: echo('PUT'),
        patchItem: echo('PATCH'),
        deleteItem: echo('DELETE'),
        optionsItem: echo('OPTIONS'),
        headItem: echo('HEAD'),
    };
};
