import { z } from 'zod';
// Not `../kizuna.js`: an identity's credential is branded, so a contract built from `src` hands the adapters identities
// their own `server.guard` cannot resolve.
import { Kizuna } from '@ts-kizuna/core';
import { ProblemDetailsSchema } from '@ts-kizuna/core/schemas';
import { createPlugin } from '@ts-kizuna/core/adapter';

const k = new Kizuna({
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

export const streamInferenceRoutes = k.routes('api', {
    reply: {
        method: 'POST',
        path: '/reply',
        body: z.object({
            prompt: z.string(),
        }),
        responses: {
            200: {
                stream: {
                    delta: z.object({
                        text: z.string(),
                    }),
                    done: z.object({
                        count: z.int(),
                    }),
                },
            },
            400: ProblemDetailsSchema,
        },
    },
});

export const streamInferenceContract = k.contract({
    routes: streamInferenceRoutes,
});

export const toolInferenceTools = k.tools(({ toolFromRoutes }) => ({
    countWords: {
        description: 'Count the words in a piece of text',
        input: z.object({
            text: z.string(),
        }),
        output: z.object({
            words: z.int(),
        }),
    },
}));

export const toolInferenceContract = k.contract({
    routes: k.routes('api', {
        summarize: {
            method: 'POST',
            path: '/summarize',
            body: z.object({
                text: z.string(),
            }),
            responses: {
                200: z.object({
                    words: z.int(),
                }),
            },
        },
    }),
    tools: toolInferenceTools,
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

export const workspacePermissions = Kizuna.permissions({
    workspace: ['read', 'delete'],
});

export const workspaceRoles = Kizuna.roles(workspacePermissions, {
    admin: {
        workspace: ['read'],
    },
    owner: 'all',
});

export const memberIdentity = Kizuna.identity.apiKey({
    name: 'x-workspace-token',
    in: 'header',
    context: z.object({
        workspaceUserId: z.string(),
    }),
    roles: workspaceRoles,
});

const securedK = new Kizuna({
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
    adminOnly: {
        method: 'GET',
        path: '/admin-only',
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
    accessControl: {
        api: {
            '*': false,
            whoAmI: 'user',
            ownerOnly: {
                auth: 'member',
                requires: {
                    workspace: ['delete'],
                },
            },
            adminOnly: {
                auth: 'member',
                roles: 'admin',
            },
            both: {
                auth: ['user', 'member'],
            },
        },
    },
});

export const apiConsumerIdentity = Kizuna.identity.apiKey({
    name: 'x-api-key',
    in: 'header',
});

const gateK = new Kizuna({
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
    accessControl: {
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

const requestContextK = new Kizuna({
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
    accessControl: {
        api: false,
    },
});

const typedProbePlugin = createPlugin<{ label: () => string }>()({
    name: 'probe',
    serverModule: '@ts-kizuna/core/adapter-testing',
    routes: {
        ping: {
            method: 'GET',
            path: '/probe/ping',
            responses: {
                200: z.object({
                    pong: z.boolean(),
                }),
            },
        },
    },
});

const pluginTypeK = new Kizuna({
    tags: Kizuna.tags({
        api: 'API',
    }),
});

export const pluginTypeContract = pluginTypeK.contract({
    plugins: {
        probe: typedProbePlugin,
    },
    routes: pluginTypeK.routes('api', {
        whichLabel: {
            method: 'GET',
            path: '/which-label',
            responses: {
                200: z.object({
                    label: z.string(),
                }),
            },
        },
    }),
    jobs: pluginTypeK.jobs({
        reindex: {
            summary: 'Re-index one record',
            input: z.object({
                recordId: z.string(),
            }),
        },
    }),
});
