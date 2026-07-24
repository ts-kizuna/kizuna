import { expectTypeOf, test } from 'vitest';
import type { Request } from 'express';
import type { RouteDefinition } from '@ts-kizuna/core';
import { z } from 'zod';
import { kizuna, createTags, createIdentity, createRequestContext } from '@ts-kizuna/core';
import { createApi, createRequestContextResolver, createGuard, createRouter, createServer, type RouteHandler } from './server.js';

const { k } = kizuna({
    tags: createTags({
        api: 'API',
    }),
});

const contractRoutes = k.routes('api', {
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

const contract = k.contract({
    routes: contractRoutes,
});

test('handler receives typed path params', () => {
    createRouter(contract, {
        getUser: ({ params }) => {
            expectTypeOf(params).toEqualTypeOf<{ id: string }>();
            return {
                status: 200,
                body: {
                    id: params.id,
                    name: 'x',
                },
            };
        },
        createUser: ({ body }) => {
            expectTypeOf(body).toEqualTypeOf<{ name: string; email: string }>();
            return {
                status: 201,
                body: {
                    id: '1',
                    name: body.name,
                    email: body.email,
                },
            };
        },
    });
});

test('Express Request is augmented with kizunaRoute', () => {
    expectTypeOf<Request['kizunaRoute']>().toEqualTypeOf<RouteDefinition | undefined>();
});

const nestedContract = k.contract({
    routes: {
        users: contractRoutes,
    },
});

test('server.router contextually types a bare route group without widening', () => {
    const { server } = createServer(nestedContract);

    // @ts-expect-error 418 is not a declared response of getUser.
    server.router(contractRoutes, {
        getUser: () => ({
            status: 418,
            body: {
                id: '1',
                name: 'x',
            },
        }),
        createUser: () => ({
            status: 201,
            body: {
                id: '1',
                name: 'a',
                email: 'e',
            },
        }),
    });
});

const userIdentity = createIdentity.bearer({
    context: z.object({
        userId: z.string(),
    }),
});

const memberIdentity = createIdentity.apiKey({
    name: 'x-workspace-token',
    in: 'header',
    context: z.object({
        workspaceUserId: z.string(),
    }),
    access: z.object({
        role: z.enum(['owner', 'admin']),
    }),
});

const { k: securedK } = kizuna({
    identities: {
        user: userIdentity,
        member: memberIdentity,
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
                member: {
                    role: 'owner',
                },
            },
        },
    },
});

test('secured handlers receive typed identity context; public handlers do not', () => {
    createRouter(securedContract, {
        api: {
            publicRoute: (args) => {
                expectTypeOf(args).not.toHaveProperty('auth');
                return {
                    status: 200,
                    body: {
                        ok: true,
                    },
                };
            },
            whoAmI: ({ auth }) => {
                expectTypeOf(auth.user).toEqualTypeOf<{ userId: string }>();
                return {
                    status: 200,
                    body: {
                        userId: auth.user.userId,
                    },
                };
            },
            ownerOnly: ({ auth }) => {
                expectTypeOf(auth.member.role).toEqualTypeOf<'owner'>();
                return {
                    status: 200,
                    body: {
                        ok: true,
                    },
                };
            },
        },
    });
});

test('createRouter types a single group by key', () => {
    createRouter(securedContract, 'api', {
        publicRoute: () => ({
            status: 200,
            body: {
                ok: true,
            },
        }),
        whoAmI: ({ auth }) => {
            expectTypeOf(auth.user).toEqualTypeOf<{ userId: string }>();
            return {
                status: 200,
                body: {
                    userId: auth.user.userId,
                },
            };
        },
        ownerOnly: () => ({
            status: 200,
            body: {
                ok: true,
            },
        }),
    });
});

test('a standalone RouteHandler carries the route auth its map resolves, and drops into the group router', () => {
    const whoAmI: RouteHandler<typeof securedContract.routes.api.whoAmI> = ({ auth }) => {
        expectTypeOf(auth.user).toEqualTypeOf<{ userId: string }>();
        return {
            status: 200,
            body: {
                userId: auth.user.userId,
            },
        };
    };
    createRouter(securedContract, 'api', {
        publicRoute: () => ({
            status: 200,
            body: {
                ok: true,
            },
        }),
        whoAmI,
        ownerOnly: () => ({
            status: 200,
            body: {
                ok: true,
            },
        }),
    });
});

test('createGuard types the credential by identity kind and checks the return', () => {
    createGuard(securedContract, 'user', ({ bearer, deny, scopes }) => {
        expectTypeOf(bearer).toEqualTypeOf<{ token: string } | null>();
        expectTypeOf(scopes).toEqualTypeOf<string[]>();
        if (!bearer) return deny(401, 'Unauthorized');
        return {
            userId: bearer.token,
        };
    });

    createGuard(securedContract, 'member', ({ apiKey, deny }) => {
        expectTypeOf(apiKey).toEqualTypeOf<{ in: 'header'; name: 'x-workspace-token'; value: string } | null>();
        if (!apiKey) return deny(403, 'Forbidden');
        return {
            workspaceUserId: apiKey.value,
            role: 'owner',
        };
    });

    createGuard(
        securedContract,
        'user',
        // @ts-expect-error the guard result must match the identity's context schema
        ({ deny }) => {
            void deny;
            return {
                wrongField: true,
            };
        }
    );

    // @ts-expect-error 'admin' is not a declared identity
    createGuard(securedContract, 'admin', () => ({}));
});

test('createApi requires a complete guard map when guards are provided', () => {
    const guardFn = createGuard(securedContract, 'user', ({ deny }) => deny(401, 'Unauthorized'));
    createApi({
        contract: securedContract,
        router: {
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
            },
        },
        // @ts-expect-error the member guard is missing
        guards: {
            user: guardFn,
        },
    });
});

const apiConsumerIdentity = createIdentity.apiKey({
    name: 'x-api-key',
    in: 'header',
});

const { k: gateK } = kizuna({
    identities: {
        user: userIdentity,
        apiConsumer: apiConsumerIdentity,
    },
});

const gateRoutes = gateK.routes({
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

const gateContract = gateK.contract({
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

test('a gate-only guard may return void (or deny) — no context to return', () => {
    createGuard(gateContract, 'apiConsumer', ({ apiKey, deny }) => {
        if (!apiKey) return deny(401, 'Unauthorized');
    });

    createGuard(gateContract, 'apiConsumer', ({ apiKey, deny }) => {
        if (!apiKey) return deny(401, 'Unauthorized');
        return;
    });
});

test('a context-ful guard must still return its context', () => {
    createGuard(
        gateContract,
        'user',
        // @ts-expect-error a context-ful guard must return its context, not void
        ({ deny }) => {
            void deny;
        }
    );
});

test('a handler for a gate-only route receives no arg for the identity', () => {
    createRouter(gateContract, {
        api: {
            publicRoute: (args) => {
                expectTypeOf(args).not.toHaveProperty('auth');
                return {
                    status: 200,
                    body: {
                        ok: true,
                    },
                };
            },
            apiOnly: (args) => {
                // The gate-only identity contributes `{}` — no `auth` arg.
                expectTypeOf(args).not.toHaveProperty('auth');
                return {
                    status: 200,
                    body: {
                        ok: true,
                    },
                };
            },
            whoAmI: ({ auth }) => {
                expectTypeOf(auth.user).toEqualTypeOf<{ userId: string }>();
                return {
                    status: 200,
                    body: {
                        userId: auth.user.userId,
                    },
                };
            },
        },
    });
});

const { k: contextK } = kizuna({
    identities: {
        user: userIdentity,
    },
    requestContext: {
        analytics: createRequestContext(
            z.object({
                sessionId: z.string().nullable(),
            })
        ),
    },
});

const contextContract = contextK.contract({
    routes: {
        api: contextK.routes({
            publicRoute: {
                method: 'GET',
                path: '/public',
                responses: {
                    200: z.object({
                        ok: z.boolean(),
                    }),
                },
            },
        }),
    },
    auth: {
        api: false,
    },
});

test('handlers receive typed request context on every route', () => {
    createRouter(contextContract, {
        api: {
            publicRoute: ({ requestContext }) => {
                expectTypeOf(requestContext.analytics).toEqualTypeOf<{ sessionId: string | null }>();
                return {
                    status: 200,
                    body: {
                        ok: true,
                    },
                };
            },
        },
    });
});

test('a standalone RouteHandler carries request context', () => {
    const publicRoute: RouteHandler<typeof contextContract.routes.api.publicRoute> = ({ requestContext }) => {
        expectTypeOf(requestContext.analytics).toEqualTypeOf<{ sessionId: string | null }>();
        return {
            status: 200,
            body: {
                ok: true,
            },
        };
    };
    createRouter(contextContract, 'api', {
        publicRoute,
    });
});

test('createRequestContextResolver checks the return against its schema', () => {
    createRequestContextResolver(contextContract, 'analytics', ({ req }) => ({
        sessionId: req.header('x-posthog-session-id') ?? null,
    }));

    createRequestContextResolver(
        contextContract,
        'analytics',
        // @ts-expect-error the provider must return the schema's shape
        () => ({
            wrongField: true,
        })
    );

    // @ts-expect-error 'metrics' is not a declared context key
    createRequestContextResolver(contextContract, 'metrics', () => ({}));
});

test('createApi requires providers when the contract declares context', () => {
    const provider = createRequestContextResolver(contextContract, 'analytics', () => ({
        sessionId: null,
    }));
    createApi({
        contract: contextContract,
        router: {
            api: {
                publicRoute: () => ({
                    status: 200,
                    body: {
                        ok: true,
                    },
                }),
            },
        },
        requestContext: {
            analytics: provider,
        },
    });

    // @ts-expect-error context providers are required when the contract declares context
    createApi({
        contract: contextContract,
        router: {
            api: {
                publicRoute: () => ({
                    status: 200,
                    body: {
                        ok: true,
                    },
                }),
            },
        },
    });
});
