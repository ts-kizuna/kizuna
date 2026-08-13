import { expectTypeOf, test } from 'vitest';
import type { Request } from 'express';
import type { RouteDefinition } from '@ts-kizuna/core';
import type { GuardRun, RequestContextRun } from '@ts-kizuna/core/adapter';
import {
    checkAdapterTypeFeatures,
    gateContract,
    inferenceContract,
    inferenceGroupContract,
    inferenceRoutes,
    pluginTypeContract,
    permissionTypeContract,
    requestContextContract,
    securedContract,
    type ExpectedRouteHandler,
    type ExpectedRouter,
} from '../../core/src/adapter-testing/type-testing.js';
import { KizunaServer, type ExpressHandlerContext, type RouteHandler, type Router } from './server.js';

const securedServer = new KizunaServer(securedContract);
const gateServer = new KizunaServer(gateContract);
const requestContextServer = new KizunaServer(requestContextContract);

test('conforms to the shared adapter type catalogue', () => {
    checkAdapterTypeFeatures('express', {
        'surface.router': () => {
            expectTypeOf<Router<typeof securedContract>>().toEqualTypeOf<ExpectedRouter<typeof securedContract, ExpressHandlerContext>>();
            expectTypeOf<Router<typeof inferenceRoutes>>().toEqualTypeOf<ExpectedRouter<typeof inferenceRoutes, ExpressHandlerContext>>();
        },
        'surface.routeHandler': () => {
            expectTypeOf<RouteHandler<typeof inferenceRoutes.getUser>>().toEqualTypeOf<
                ExpectedRouteHandler<typeof inferenceRoutes.getUser, ExpressHandlerContext>
            >();
        },
        'surface.guardRun': () => {
            expectTypeOf(securedServer.guard('user', ({ deny }) => deny(401, 'Unauthorized'))).toEqualTypeOf<
                GuardRun<ExpressHandlerContext>
            >();
        },
        'surface.requestContextRun': () => {
            expectTypeOf(
                requestContextServer.requestContext('analytics', () => ({
                    sessionId: null,
                }))
            ).toEqualTypeOf<RequestContextRun<ExpressHandlerContext>>();
        },
        'router.groupByName': () => {
            const server = new KizunaServer(inferenceGroupContract);

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
            const server = new KizunaServer(inferenceGroupContract);

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
            const server = new KizunaServer(inferenceGroupContract);

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
            expectTypeOf<Router<typeof inferenceContract>['getUser']>().parameter(0).toMatchTypeOf<ExpressHandlerContext>();
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
            securedServer.guard('user', ({ bearer, deny, scopes }) => {
                expectTypeOf(bearer).toEqualTypeOf<{ token: string } | null>();
                expectTypeOf(scopes).toEqualTypeOf<string[]>();
                if (!bearer) return deny(401, 'Unauthorized');
                return {
                    userId: bearer.token,
                };
            });

            securedServer.guard('member', ({ apiKey, deny }) => {
                expectTypeOf(apiKey).toEqualTypeOf<{ in: 'header'; name: 'x-workspace-token'; value: string } | null>();
                if (!apiKey) return deny(403, 'Forbidden');
                return {
                    workspaceUserId: apiKey.value,
                    role: 'owner' as const,
                };
            });
        },
        'guards.returnChecked': () => {
            securedServer.guard(
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
            gateServer.guard('apiConsumer', ({ apiKey, deny }) => {
                if (!apiKey) return deny(401, 'Unauthorized');
            });

            gateServer.guard(
                'user',
                // @ts-expect-error a context-ful guard must return its context, not void
                ({ deny }) => {
                    void deny;
                }
            );
        },
        'guards.unknownIdentity': () => {
            // @ts-expect-error 'admin' is not a declared identity
            securedServer.guard('admin', () => ({}));
        },
        'guards.completeMap': () => {
            const requireUser = securedServer.guard('user', ({ deny }) => deny(401, 'Unauthorized'));

            new KizunaServer(securedContract).api({
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
                        both: ({ auth }) => ({
                            status: 200,
                            body: {
                                userId: auth.user.userId,
                                workspaceUserId: auth.member.workspaceUserId,
                            },
                        }),
                    },
                },
                // @ts-expect-error the member guard is missing
                guards: {
                    user: requireUser,
                },
            });
            // @ts-expect-error guards is required when the contract declares identities
            new KizunaServer(securedContract).api({
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
                        both: ({ auth }) => ({
                            status: 200,
                            body: {
                                userId: auth.user.userId,
                                workspaceUserId: auth.member.workspaceUserId,
                            },
                        }),
                    },
                },
            });
        },
        'requestContext.handlerArg': () => {
            expectTypeOf<Router<typeof requestContextContract>['api']['publicRoute']>().parameter(0).toMatchTypeOf<{
                requestContext: { analytics: { sessionId: string | null } };
            }>();
        },
        'requestContext.resolverReturn': () => {
            requestContextServer.requestContext(
                'analytics',
                // @ts-expect-error the resolver must return the schema's shape
                () => ({
                    wrongField: true,
                })
            );
        },
        'requestContext.unknownKey': () => {
            // @ts-expect-error 'metrics' is not a declared context key
            requestContextServer.requestContext('metrics', () => ({}));
        },
        'requestContext.requiredOnApi': () => {
            // @ts-expect-error context resolvers are required when the contract declares context
            new KizunaServer(requestContextContract).api({
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

            new KizunaServer(securedContract).router('api', {
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
        'standalone.routeGroupContractArgs': () => {
            type GroupArgs = Parameters<Router<typeof pluginTypeContract.routes>['whichLabel']>[0];
            type ContractArgs = Parameters<Router<typeof pluginTypeContract>['whichLabel']>[0];

            expectTypeOf<GroupArgs['plugins']>().toEqualTypeOf<ContractArgs['plugins']>();
            expectTypeOf<GroupArgs['jobs']>().toEqualTypeOf<ContractArgs['jobs']>();
        },
        'standalone.routeHandlerContractArgs': () => {
            type RouteArgs = Parameters<RouteHandler<typeof pluginTypeContract.routes.whichLabel>>[0];
            type ContractArgs = Parameters<Router<typeof pluginTypeContract>['whichLabel']>[0];

            expectTypeOf<RouteArgs['plugins']>().toEqualTypeOf<ContractArgs['plugins']>();
            expectTypeOf<RouteArgs['jobs']>().toEqualTypeOf<ContractArgs['jobs']>();
        },
        'plugins.exportsTyped': () => {
            expectTypeOf<Router<typeof pluginTypeContract>['whichLabel']>().parameter(0).toMatchTypeOf<{
                plugins: { probe: { label: () => string } };
            }>();
        },
        'permissions.canTyped': () => {
            expectTypeOf<Router<typeof permissionTypeContract>['workspace']['transfer']>().parameter(0).toMatchTypeOf<{
                can: {
                    viewInvoices: () => Promise<boolean>;
                    promoteMember: (record: { id: string; role: 'owner' | 'admin' }) => Promise<boolean>;
                };
            }>();
        },
        'permissions.absentWhenNoneDeclared': () => {
            expectTypeOf<Router<typeof inferenceContract>['getUser']>().parameter(0).not.toHaveProperty('can');
        },
        'permissions.requiredOnApi': () => {
            // @ts-expect-error a contract declaring permissions requires one implementation each
            new KizunaExpressServer(permissionTypeContract).api({
                router: {} as Router<typeof permissionTypeContract>,
            });
        },
        'plugins.absentWhenUninstalled': () => {
            expectTypeOf<Router<typeof inferenceContract>['getUser']>().parameter(0).not.toHaveProperty('plugins');
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

            new KizunaServer(requestContextContract).router('api', {
                publicRoute,
            });
        },
    });
});

test('Express Request is augmented with kizunaRoute', () => {
    expectTypeOf<Request['kizunaRoute']>().toEqualTypeOf<RouteDefinition | undefined>();
});

test('a request context resolver reads the Express request', () => {
    requestContextServer.requestContext('analytics', ({ req }) => ({
        sessionId: req.header('x-posthog-session-id') ?? null,
    }));
});
