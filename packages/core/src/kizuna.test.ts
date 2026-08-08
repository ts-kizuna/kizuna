import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { RouteDefinition, Routes } from './types.js';
import { Kizuna } from './namespace.js';

const user = Kizuna.identity.bearer({
    context: z.object({
        userId: z.string(),
    }),
});

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

const routeDefinition = (path: `/${string}`) => ({
    method: 'GET' as const,
    path,
    responses: {
        200: z.object({
            ok: z.boolean(),
        }),
    },
});

const makeRoutes = () => {
    const { k } = Kizuna.init({
        identities: {
            user,
            member,
        },
    });
    return {
        k,
        users: k.routes({
            listUsers: routeDefinition('/users'),
            getUser: routeDefinition('/users/:id'),
        }),
        workspace: k.routes({
            getWorkspace: routeDefinition('/workspace'),
            deleteWorkspace: routeDefinition('/workspace/delete'),
        }),
    };
};

const routeOf = (routes: Routes, key: string): RouteDefinition => routes[key] as RouteDefinition;

const makeNestedRoutes = () => {
    const { k } = Kizuna.init({
        identities: {
            user,
            member,
        },
    });
    return {
        k,
        members: k.routes({
            session: {
                login: routeDefinition('/auth/login'),
                refresh: routeDefinition('/auth/refresh'),
                me: routeDefinition('/auth/me'),
            },
            events: {
                list: routeDefinition('/events'),
                get: routeDefinition('/events/:eventId'),
            },
            invites: {
                list: routeDefinition('/invites'),
                get: routeDefinition('/invites/:inviteId'),
            },
        }),
    };
};

const nestedRouteOf = (routes: Routes, groupKey: string, routeKey: string): RouteDefinition =>
    routeOf(routes[groupKey] as Routes, routeKey);

describe('k.contract auth resolution', () => {
    it('marks a group public with security: [] when auth is false', () => {
        const { k, users, workspace } = makeRoutes();
        k.contract({
            routes: {
                users,
                workspace,
            },
            auth: {
                users: false,
                workspace: false,
            },
        });
        expect(routeOf(users, 'listUsers').security).toEqual([]);
        expect(routeOf(users, 'getUser').security).toEqual([]);
    });

    it('requires an identity across a group from a scheme name', () => {
        const { k, users, workspace } = makeRoutes();
        k.contract({
            routes: {
                users,
                workspace,
            },
            auth: {
                users: 'user',
                workspace: false,
            },
        });
        expect(routeOf(users, 'listUsers').security).toEqual(['user']);
        expect(routeOf(users, 'listUsers').accessGate).toBeUndefined();
    });

    it('resolves a field constraint into security plus an access gate', () => {
        const { k, users, workspace } = makeRoutes();
        k.contract({
            routes: {
                users,
                workspace,
            },
            auth: {
                users: false,
                workspace: {
                    member: {
                        role: 'owner',
                    },
                },
            },
        });
        expect(routeOf(workspace, 'getWorkspace').security).toEqual([
            {
                member: [],
            },
        ]);
        expect(routeOf(workspace, 'getWorkspace').accessGate).toEqual({
            member: {
                role: 'owner',
            },
        });
    });

    it('resolves an oauth2 scope array into the requirement without a gate', () => {
        const { k, users, workspace } = makeRoutes();
        k.contract({
            routes: {
                users,
                workspace,
            },
            auth: {
                users: false,
                workspace: {
                    user: ['read:workspace'],
                },
            },
        });
        expect(routeOf(workspace, 'getWorkspace').security).toEqual([
            {
                user: ['read:workspace'],
            },
        ]);
        expect(routeOf(workspace, 'getWorkspace').accessGate).toBeUndefined();
    });

    it('cascades a * default with per-route overrides', () => {
        const { k, users, workspace } = makeRoutes();
        k.contract({
            routes: {
                users,
                workspace,
            },
            auth: {
                users: false,
                workspace: {
                    '*': 'member',
                    deleteWorkspace: {
                        member: {
                            role: 'owner',
                        },
                    },
                },
            },
        });
        expect(routeOf(workspace, 'getWorkspace').security).toEqual(['member']);
        expect(routeOf(workspace, 'deleteWorkspace').security).toEqual([
            {
                member: [],
            },
        ]);
        expect(routeOf(workspace, 'deleteWorkspace').accessGate).toEqual({
            member: {
                role: 'owner',
            },
        });
    });

    it('applies group auth to routes in nested groups', () => {
        const { k } = makeRoutes();
        const nested = k.routes({
            inner: {
                getThing: routeDefinition('/things/:id'),
            },
        });
        k.contract({
            routes: {
                nested,
            },
            auth: {
                nested: 'user',
            },
        });
        expect(routeOf(nested.inner as Routes, 'getThing').security).toEqual(['user']);
    });

    it('carries the identities and auth map on the contract', () => {
        const { k, users, workspace } = makeRoutes();
        const contract = k.contract({
            routes: {
                users,
                workspace,
            },
            auth: {
                users: false,
                workspace: 'member',
            },
        });
        expect(contract.securitySchemes).toEqual({
            user,
            member,
        });
        expect(contract.auth).toEqual({
            users: false,
            workspace: 'member',
        });
    });

    it('leaves routes untouched when no auth map is passed', () => {
        const { k } = Kizuna.init();
        const routes = k.routes({
            listItems: routeDefinition('/items'),
        });
        const contract = k.contract({
            routes: {
                items: routes,
            },
        });
        expect(routeOf(routes, 'listItems').security).toBeUndefined();
        expect(contract.securitySchemes).toBeUndefined();
    });
});

describe('multi-identity auth values', () => {
    it('resolves { scheme: true } to a bare requirement without a gate', () => {
        const { k, users, workspace } = makeRoutes();
        k.contract({
            routes: {
                users,
                workspace,
            },
            auth: {
                users: false,
                workspace: {
                    user: true,
                    member: {
                        role: 'owner',
                    },
                },
            },
        });
        expect(routeOf(workspace, 'getWorkspace').security).toEqual([
            {
                user: [],
                member: [],
            },
        ]);
        expect(routeOf(workspace, 'getWorkspace').accessGate).toEqual({
            member: {
                role: 'owner',
            },
        });
    });
});

describe('cascade merging', () => {
    it('merges a route entry into the * default, inheriting its identities', () => {
        const { k, users, workspace } = makeRoutes();
        k.contract({
            routes: {
                users,
                workspace,
            },
            auth: {
                users: false,
                workspace: {
                    '*': 'member',
                    deleteWorkspace: {
                        user: true,
                    },
                },
            },
        });
        expect(routeOf(workspace, 'deleteWorkspace').security).toEqual([
            {
                member: [],
                user: [],
            },
        ]);
    });

    it('lets a route entry refine the default identity without restating it', () => {
        const { k, users, workspace } = makeRoutes();
        k.contract({
            routes: {
                users,
                workspace,
            },
            auth: {
                users: false,
                workspace: {
                    '*': 'member',
                    deleteWorkspace: {
                        member: {
                            role: 'owner',
                        },
                    },
                },
            },
        });
        expect(routeOf(workspace, 'deleteWorkspace').security).toEqual([
            {
                member: [],
            },
        ]);
        expect(routeOf(workspace, 'deleteWorkspace').accessGate).toEqual({
            member: {
                role: 'owner',
            },
        });
    });

    it('rejects a cascade key that matches no route or subgroup in the group', () => {
        const { k, users, workspace } = makeRoutes();
        expect(() =>
            // @ts-expect-error renameWorkspace is not a route in the group
            k.contract({
                routes: {
                    users,
                    workspace,
                },
                auth: {
                    users: false,
                    workspace: {
                        '*': 'member',
                        renameWorkspace: false,
                    },
                },
            })
        ).toThrow(/renameWorkspace/);
    });

    it('false opts a route out of the default', () => {
        const { k, users, workspace } = makeRoutes();
        k.contract({
            routes: {
                users,
                workspace,
            },
            auth: {
                users: false,
                workspace: {
                    '*': 'member',
                    getWorkspace: false,
                },
            },
        });
        expect(routeOf(workspace, 'getWorkspace').security).toEqual([]);
        expect(routeOf(workspace, 'deleteWorkspace').security).toEqual(['member']);
    });
});

describe('nested group auth', () => {
    it('applies an AuthValue on a subgroup key to that whole subtree', () => {
        const { k, members } = makeNestedRoutes();
        k.contract({
            routes: {
                members,
            },
            auth: {
                members: {
                    '*': 'user',
                    invites: false,
                },
            },
        });
        expect(nestedRouteOf(members, 'invites', 'list').security).toEqual([]);
        expect(nestedRouteOf(members, 'invites', 'get').security).toEqual([]);
        expect(nestedRouteOf(members, 'events', 'list').security).toEqual(['user']);
        expect(nestedRouteOf(members, 'session', 'login').security).toEqual(['user']);
    });

    it('recurses into a nested cascade on a subgroup key', () => {
        const { k, members } = makeNestedRoutes();
        k.contract({
            routes: {
                members,
            },
            auth: {
                members: {
                    '*': 'user',
                    session: {
                        '*': 'user',
                        login: false,
                        refresh: false,
                    },
                },
            },
        });
        expect(nestedRouteOf(members, 'session', 'login').security).toEqual([]);
        expect(nestedRouteOf(members, 'session', 'refresh').security).toEqual([]);
        expect(nestedRouteOf(members, 'session', 'me').security).toEqual([
            {
                user: [],
            },
        ]);
        expect(nestedRouteOf(members, 'events', 'list').security).toEqual(['user']);
    });

    it("merges a nested cascade's * into the parent group default", () => {
        const { k, members } = makeNestedRoutes();
        k.contract({
            routes: {
                members,
            },
            auth: {
                members: {
                    '*': 'user',
                    events: {
                        '*': {
                            member: {
                                role: 'owner',
                            },
                        },
                        list: false,
                    },
                },
            },
        });
        expect(nestedRouteOf(members, 'events', 'get').security).toEqual([
            {
                user: [],
                member: [],
            },
        ]);
        expect(nestedRouteOf(members, 'events', 'get').accessGate).toEqual({
            member: {
                role: 'owner',
            },
        });
        expect(nestedRouteOf(members, 'events', 'list').security).toEqual([]);
    });

    it('merges an AuthValue on a subgroup key into the parent group default', () => {
        const { k, members } = makeNestedRoutes();
        k.contract({
            routes: {
                members,
            },
            auth: {
                members: {
                    '*': 'user',
                    events: {
                        member: {
                            role: 'owner',
                        },
                    },
                },
            },
        });
        expect(nestedRouteOf(members, 'events', 'list').security).toEqual([
            {
                user: [],
                member: [],
            },
        ]);
        expect(nestedRouteOf(members, 'events', 'list').accessGate).toEqual({
            member: {
                role: 'owner',
            },
        });
    });

    it('does not match a cascade key against leaf routes in subgroups', () => {
        const { k, members } = makeNestedRoutes();
        expect(() =>
            // @ts-expect-error list is not a route or subgroup directly in members
            k.contract({
                routes: {
                    members,
                },
                auth: {
                    members: {
                        '*': 'user',
                        list: false,
                    },
                },
            })
        ).toThrow(/list/);
        expect(nestedRouteOf(members, 'events', 'list').security).not.toEqual([]);
        expect(nestedRouteOf(members, 'invites', 'list').security).not.toEqual([]);
    });

    it('rejects a nested cascade on a route key', () => {
        const { k, members } = makeNestedRoutes();
        expect(() =>
            // @ts-expect-error login is a route, not a group
            k.contract({
                routes: {
                    members,
                },
                auth: {
                    members: {
                        '*': 'user',
                        session: {
                            '*': 'user',
                            login: {
                                '*': false,
                            },
                        },
                    },
                },
            })
        ).toThrow(/login/);
    });
});
