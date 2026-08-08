import { expectTypeOf, test } from 'vitest';
import type { GuardRun, RequestContextRun } from '@ts-kizuna/core/adapter';
import {
    checkAdapterTypeFeatures,
    gateContract,
    inferenceContract,
    inferenceGroupContract,
    inferenceRoutes,
    requestContextContract,
    securedContract,
    type ExpectedRouteHandler,
    type ExpectedRouter,
} from '../../core/src/adapter-testing/type-testing.js';
import {
    createApi,
    createGuard,
    createRequestContextResolver,
    createRouter,
    createServer,
    type FastifyHandlerContext,
    type FastifyPreHandler,
    type RouteHandler,
    type Router,
} from './server.js';

test('conforms to the shared adapter type catalogue', () => {
    checkAdapterTypeFeatures('fastify', {
        'surface.router': () => {
            expectTypeOf<Router<typeof securedContract>>().toEqualTypeOf<ExpectedRouter<typeof securedContract, FastifyHandlerContext>>();
            expectTypeOf<Router<typeof inferenceRoutes>>().toEqualTypeOf<ExpectedRouter<typeof inferenceRoutes, FastifyHandlerContext>>();
        },
        'surface.routeHandler': () => {
            expectTypeOf<RouteHandler<typeof inferenceRoutes.getUser>>().toEqualTypeOf<
                ExpectedRouteHandler<typeof inferenceRoutes.getUser, FastifyHandlerContext>
            >();
        },
        'surface.guardRun': () => {
            expectTypeOf(createGuard(securedContract, 'user', ({ deny }) => deny(401, 'Unauthorized'))).toEqualTypeOf<
                GuardRun<FastifyHandlerContext>
            >();
        },
        'surface.requestContextRun': () => {
            expectTypeOf(
                createRequestContextResolver(requestContextContract, 'analytics', () => ({
                    sessionId: null,
                }))
            ).toEqualTypeOf<RequestContextRun<FastifyHandlerContext>>();
        },
        'router.groupByName': () => {
            const { server } = createServer(inferenceGroupContract);

            const users = server.router('users', {
                getUser: async () => ({
                    status: 200,
                    body: {
                        id: '1',
                        name: 'Ada',
                    },
                }),
                createUser: async () => ({
                    status: 201,
                    body: {
                        id: '1',
                        name: 'Ada',
                        email: 'ada@example.com',
                    },
                }),
            });

            server.api({
                router: {
                    users,
                },
            });
        },
        'router.bareRouteGroup': () => {
            const { server } = createServer(inferenceGroupContract);

            server.router(inferenceRoutes, {
                getUser: () => ({
                    status: 200,
                    body: {
                        id: '1',
                        name: 'Ada',
                    },
                }),
                createUser: () => ({
                    status: 201,
                    body: {
                        id: '1',
                        name: 'Ada',
                        email: 'ada@example.com',
                    },
                }),
            });
        },
        'router.undeclaredStatus': () => {
            const { server } = createServer(inferenceGroupContract);

            server.router('users', {
                getUser: () => ({
                    // @ts-expect-error 418 is not a declared response of getUser.
                    status: 418,
                }),
                createUser: () => ({
                    status: 201,
                    body: {
                        id: '1',
                        name: 'Ada',
                        email: 'ada@example.com',
                    },
                }),
            });
        },
        'router.groupByKey': () => {
            createRouter(securedContract, 'api', {
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
            });
        },
        'handler.pathParams': () => {
            expectTypeOf<Router<typeof inferenceContract>['getUser']>().parameter(0).toMatchTypeOf<{ params: { id: string } }>();
        },
        'handler.body': () => {
            expectTypeOf<Router<typeof inferenceContract>['createUser']>()
                .parameter(0)
                .toMatchTypeOf<{ body: { name: string; email: string } }>();
            expectTypeOf<Router<typeof inferenceContract>['getUser']>().parameter(0).toMatchTypeOf<{ body: undefined }>();
        },
        'handler.context': () => {
            expectTypeOf<Router<typeof inferenceContract>['getUser']>().parameter(0).toMatchTypeOf<FastifyHandlerContext>();
        },
        'guards.identityContext': () => {
            expectTypeOf<Router<typeof securedContract>['api']['whoAmI']>()
                .parameter(0)
                .toMatchTypeOf<{ auth: { user: { userId: string } } }>();
            expectTypeOf<Router<typeof securedContract>['api']['ownerOnly']>()
                .parameter(0)
                .toMatchTypeOf<{ auth: { member: { role: 'owner' } } }>();
            expectTypeOf<Router<typeof securedContract>['api']['both']>().parameter(0).toMatchTypeOf<{
                auth: { user: { userId: string }; member: { workspaceUserId: string } };
            }>();
        },
        'guards.publicNoAuth': () => {
            expectTypeOf<Router<typeof securedContract>['api']['publicRoute']>().parameter(0).not.toHaveProperty('auth');
        },
        'guards.gateOnlyNoAuth': () => {
            expectTypeOf<Router<typeof gateContract>['api']['apiOnly']>().parameter(0).not.toHaveProperty('auth');
            expectTypeOf<Router<typeof gateContract>['api']['whoAmI']>()
                .parameter(0)
                .toMatchTypeOf<{ auth: { user: { userId: string } } }>();
        },
        'guards.credentialByKind': () => {
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
                    role: 'owner' as const,
                };
            });
        },
        'guards.returnChecked': () => {
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
        },
        'guards.gateOnlyVoid': () => {
            createGuard(gateContract, 'apiConsumer', ({ apiKey, deny }) => {
                if (!apiKey) return deny(401, 'Unauthorized');
            });

            createGuard(
                gateContract,
                'user',
                // @ts-expect-error a context-ful guard must return its context, not void
                ({ deny }) => {
                    void deny;
                }
            );
        },
        'guards.unknownIdentity': () => {
            // @ts-expect-error 'admin' is not a declared identity
            createGuard(securedContract, 'admin', () => ({}));
        },
        'guards.completeMap': () => {
            const requireUser = createGuard(securedContract, 'user', ({ deny }) => deny(401, 'Unauthorized'));

            createApi({
                contract: securedContract,
                router: createRouter(securedContract, {
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
                }),
                // @ts-expect-error the member guard is missing
                guards: {
                    user: requireUser,
                },
            });
        },
        'requestContext.handlerArg': () => {
            expectTypeOf<Router<typeof requestContextContract>['api']['publicRoute']>().parameter(0).toMatchTypeOf<{
                requestContext: { analytics: { sessionId: string | null } };
            }>();
        },
        'requestContext.resolverReturn': () => {
            createRequestContextResolver(
                requestContextContract,
                'analytics',
                // @ts-expect-error the resolver must return the schema's shape
                () => ({
                    wrongField: true,
                })
            );
        },
        'requestContext.unknownKey': () => {
            // @ts-expect-error 'metrics' is not a declared context key
            createRequestContextResolver(requestContextContract, 'metrics', () => ({}));
        },
        'requestContext.requiredOnCreateApi': () => {
            // @ts-expect-error context resolvers are required when the contract declares context
            createApi({
                contract: requestContextContract,
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
        },
        'standalone.routeHandlerAuth': () => {
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
                both: ({ auth }) => ({
                    status: 200,
                    body: {
                        userId: auth.user.userId,
                        workspaceUserId: auth.member.workspaceUserId,
                    },
                }),
            });
        },
        'standalone.routeHandlerContext': () => {
            const publicRoute: RouteHandler<typeof requestContextContract.routes.api.publicRoute> = ({ requestContext }) => {
                expectTypeOf(requestContext.analytics).toEqualTypeOf<{ sessionId: string | null }>();
                return {
                    status: 200,
                    body: {
                        ok: true,
                    },
                };
            };

            createRouter(requestContextContract, 'api', {
                publicRoute,
            });
        },
    });
});

test('a request context resolver reads the Fastify request', () => {
    createRequestContextResolver(requestContextContract, 'analytics', ({ request }) => ({
        sessionId: request.headers['x-posthog-session-id']?.toString() ?? null,
    }));
});

test('FastifyPreHandler matches a plugin prehandler', () => {
    expectTypeOf<FastifyPreHandler>().parameter(0).toMatchTypeOf<FastifyHandlerContext['request']>();
    expectTypeOf<FastifyPreHandler>().parameter(1).toMatchTypeOf<FastifyHandlerContext['reply']>();
});
