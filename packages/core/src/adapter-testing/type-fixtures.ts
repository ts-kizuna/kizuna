import { z } from 'zod';
// Not `../kizuna.js`: an identity's credential is branded, so a contract built from `src` hands the adapters identities
// their own `server.guard` cannot resolve.
import { Kizuna } from '@ts-kizuna/core';

const { k } = Kizuna.init({
    tags: Kizuna.tags({
        api: 'API',
    }),
});

/**
 * Two routes, not the runtime suite's four: every `router.*` feature writes one handler per route, once per adapter.
 */
export const inferenceRoutes = k.routes('api', {
    getUser: {
        method: 'GET',
        path: '/users/:id',
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
});

export const inferenceContract = k.contract({
    routes: inferenceRoutes,
});

export const inferenceGroupContract = k.contract({
    routes: {
        users: inferenceRoutes,
    },
});

export const userIdentity = Kizuna.identity.bearer({
    context: z.object({
        userId: z.string(),
    }),
});

export const memberIdentity = Kizuna.identity.apiKey({
    name: 'x-workspace-token',
    in: 'header',
    context: z.object({
        workspaceUserId: z.string(),
    }),
    access: z.object({
        role: z.enum(['owner', 'admin']),
    }),
});

const { k: securedK } = Kizuna.init({
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

export const apiConsumerIdentity = Kizuna.identity.apiKey({
    name: 'x-api-key',
    in: 'header',
});

const { k: gateK } = Kizuna.init({
    identities: {
        user: userIdentity,
        apiConsumer: apiConsumerIdentity,
    },
});

export const gateRoutes = gateK.routes({
    publicRoute: {
        method: 'GET',
        path: '/public',
        responses: {
            200: z.object({
                ok: z.boolean(),
            }),
        },
    },
    apiOnly: {
        method: 'GET',
        path: '/api-only',
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

export const gateContract = gateK.contract({
    routes: {
        api: gateRoutes,
    },
    auth: {
        api: {
            '*': false,
            apiOnly: 'apiConsumer',
            whoAmI: 'user',
        },
    },
});

export const analyticsContext = Kizuna.requestContext(
    z.object({
        sessionId: z.string().nullable(),
    })
);

const { k: requestContextK } = Kizuna.init({
    identities: {
        user: userIdentity,
    },
    requestContext: {
        analytics: analyticsContext,
    },
});

export const requestContextRoutes = requestContextK.routes({
    publicRoute: {
        method: 'GET',
        path: '/public',
        responses: {
            200: z.object({
                ok: z.boolean(),
            }),
        },
    },
});

export const requestContextContract = requestContextK.contract({
    routes: {
        api: requestContextRoutes,
    },
    auth: {
        api: false,
    },
});
