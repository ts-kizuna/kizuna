import { expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import type {
    HandlersFromAuth,
    HandlerReturn,
    GuardSuccess,
    GuardParams,
    RouteHandler,
    BrandedHandlerContext,
} from './handler-pipeline.js';
import type { RouteDefinition } from './types.js';
import { Kizuna } from './kizuna.js';
import { type CredentialOf } from './identity.js';

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

const k = new Kizuna({
    identities: {
        user,
        member,
    },
});

const okResponse = {
    responses: {
        200: z.object({
            ok: z.boolean(),
        }),
    },
} as const;

const users = k.routes({
    listUsers: {
        method: 'GET',
        path: '/users',
        ...okResponse,
    },
});

const workspace = k.routes({
    getWorkspace: {
        method: 'GET',
        path: '/workspace',
        ...okResponse,
    },
    deleteWorkspace: {
        method: 'DELETE',
        path: '/workspace',
        ...okResponse,
    },
});

const contract = k.contract({
    routes: {
        users,
        workspace,
    },
    auth: {
        users: false,
        workspace: {
            '*': 'user',
            deleteWorkspace: {
                member: {
                    role: 'owner',
                },
            },
        },
    },
});

type Identities = NonNullable<typeof contract.securitySchemes>;
type Handlers = HandlersFromAuth<typeof contract.routes, {}, Identities, NonNullable<typeof contract.auth>>;

test('a public route receives no auth context', () => {
    type Args = Parameters<Handlers['users']['listUsers']>[0];
    expectTypeOf<Args>().not.toHaveProperty('auth');
});

test('a group-secured route receives the identity context under auth by name', () => {
    type Args = Parameters<Handlers['workspace']['getWorkspace']>[0];
    expectTypeOf<Args['auth']['user']>().toEqualTypeOf<{ userId: string }>();
});

test('a gated route narrows the constrained access field to its literal', () => {
    type Args = Parameters<Handlers['workspace']['deleteWorkspace']>[0];
    expectTypeOf<Args['auth']['member']['role']>().toEqualTypeOf<'owner'>();
    expectTypeOf<Args['auth']['member']['workspaceUserId']>().toEqualTypeOf<string>();
});

test('a route entry inherits the * default identities', () => {
    type Args = Parameters<Handlers['workspace']['deleteWorkspace']>[0];
    expectTypeOf<Args['auth']['user']>().toEqualTypeOf<{ userId: string }>();
});

test('an auth-less contract degrades to plain handlers', () => {
    const plainK = new Kizuna();
    const items = plainK.routes({
        listItems: {
            method: 'GET',
            path: '/items',
            ...okResponse,
        },
    });
    const plainContract = plainK.contract({
        routes: {
            items,
        },
    });
    type PlainHandlers = HandlersFromAuth<typeof plainContract.routes, {}, Record<string, never>, NonNullable<typeof plainContract.auth>>;
    type Args = Parameters<PlainHandlers['items']['listItems']>[0];
    expectTypeOf<Args>().toHaveProperty('query');
    expectTypeOf<Args>().not.toHaveProperty('auth');
    expectTypeOf<ReturnType<PlainHandlers['items']['listItems']>>().toEqualTypeOf<
        HandlerReturn<(typeof items)['listItems']> | Promise<HandlerReturn<(typeof items)['listItems']>>
    >();
});

test('the auth map must cover every route group', () => {
    k.contract({
        routes: {
            users,
            workspace,
        },
        // @ts-expect-error workspace is missing from the auth map
        auth: {
            users: false,
        },
    });
});

test('the auth map rejects unknown identity names', () => {
    // @ts-expect-error 'admin' is not a declared identity
    k.contract({
        routes: {
            users,
            workspace,
        },
        auth: {
            users: false,
            workspace: 'admin',
        },
    });
});

test('k.routes rejects inline security on a route', () => {
    k.routes({
        listThings: {
            method: 'GET',
            path: '/things',
            // @ts-expect-error security is owned by the auth map
            security: ['user'],
            ...okResponse,
        },
    });
});

test('GuardSuccess accepts literal access values without an annotation', () => {
    const result: GuardSuccess<typeof member> = {
        workspaceUserId: '1',
        role: 'owner',
    };
    expectTypeOf(result.role).toEqualTypeOf<'owner' | 'admin'>();
    const invalid: GuardSuccess<typeof member> = {
        workspaceUserId: '1',
        // @ts-expect-error 'viewer' is not a member role
        role: 'viewer',
    };
    void invalid;
});

test('resolved security on a route is the typed requirement shape', () => {
    expectTypeOf<RouteDefinition['security']>().toEqualTypeOf<
        readonly (string | { [name: string]: readonly string[] | undefined })[] | undefined
    >();
});

const members = k.routes({
    session: {
        login: {
            method: 'POST',
            path: '/auth/login',
            ...okResponse,
        },
        me: {
            method: 'GET',
            path: '/auth/me',
            ...okResponse,
        },
    },
    events: {
        list: {
            method: 'GET',
            path: '/events',
            ...okResponse,
        },
        get: {
            method: 'GET',
            path: '/events/:eventId',
            ...okResponse,
        },
    },
    invites: {
        list: {
            method: 'GET',
            path: '/invites',
            ...okResponse,
        },
        get: {
            method: 'GET',
            path: '/invites/:inviteId',
            ...okResponse,
        },
    },
});

const nestedContract = k.contract({
    routes: {
        members,
    },
    auth: {
        members: {
            '*': 'user',
            session: {
                '*': 'user',
                login: false,
            },
            events: {
                member: {
                    role: 'owner',
                },
            },
            invites: false,
        },
    },
});

type NestedHandlers = HandlersFromAuth<
    typeof nestedContract.routes,
    {},
    NonNullable<typeof nestedContract.securitySchemes>,
    NonNullable<typeof nestedContract.auth>
>;

test('a route opted out in a nested cascade receives no auth context', () => {
    type Args = Parameters<NestedHandlers['members']['session']['login']>[0];
    expectTypeOf<Args>().not.toHaveProperty('auth');
});

test('a route not named in a nested cascade inherits its merged * default', () => {
    type Args = Parameters<NestedHandlers['members']['session']['me']>[0];
    expectTypeOf<Args['auth']['user']>().toEqualTypeOf<{ userId: string }>();
});

test('an AuthValue on a subgroup key merges into the parent default across its subtree', () => {
    type Args = Parameters<NestedHandlers['members']['events']['list']>[0];
    expectTypeOf<Args['auth']['user']>().toEqualTypeOf<{ userId: string }>();
    expectTypeOf<Args['auth']['member']['role']>().toEqualTypeOf<'owner'>();
});

test('a subgroup opted out with false is public despite sibling overrides for the same route keys', () => {
    type Args = Parameters<NestedHandlers['members']['invites']['list']>[0];
    expectTypeOf<Args>().not.toHaveProperty('auth');
});

test('the auth map rejects a cascade key that does not name a route or subgroup in the group', () => {
    // @ts-expect-error list is a leaf route key, not directly in members
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
    });
});

test('the auth map rejects a nested cascade on a route key', () => {
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
    });
});

test('GuardParams only derives params from the subgroups an identity secures', () => {
    type MemberParams = GuardParams<typeof nestedContract.routes, NonNullable<typeof nestedContract.auth>, 'member'>;
    expectTypeOf<MemberParams>().toEqualTypeOf<{ eventId?: string }>();
});

test('GuardParams derives param names from the routes an identity secures', () => {
    const paramRoutes = k.routes({
        getWorkspaceUser: {
            method: 'GET',
            path: '/workspaces/:workspaceId/users/:id',
            ...okResponse,
        },
        listWorkspaces: {
            method: 'GET',
            path: '/workspaces',
            ...okResponse,
        },
    });
    const paramContract = k.contract({
        routes: {
            api: paramRoutes,
        },
        auth: {
            api: 'member',
        },
    });
    type Params = GuardParams<typeof paramContract.routes, NonNullable<typeof paramContract.auth>, 'member'>;
    expectTypeOf<Params>().toEqualTypeOf<{ workspaceId?: string; id?: string }>();
    type NoParams = GuardParams<typeof paramContract.routes, NonNullable<typeof paramContract.auth>, 'user'>;
    expectTypeOf<NoParams>().toEqualTypeOf<Record<string, string>>();
});

test('a contract brands each route with the auth its map entry resolves to', () => {
    expectTypeOf<BrandedHandlerContext<typeof nestedContract.routes.members.session.me>>().toEqualTypeOf<{
        auth: { user: { userId: string } };
    }>();
});

test('a route opted out in a nested cascade carries no branded auth', () => {
    expectTypeOf<BrandedHandlerContext<typeof nestedContract.routes.members.session.login>>().toEqualTypeOf<{}>();
});

test('a branded route merges a subgroup AuthValue into the parent default', () => {
    type Context = BrandedHandlerContext<typeof nestedContract.routes.members.events.list>;
    expectTypeOf<Context['auth']['user']>().toEqualTypeOf<{ userId: string }>();
    expectTypeOf<Context['auth']['member']['role']>().toEqualTypeOf<'owner'>();
    expectTypeOf<Context['auth']['member']['workspaceUserId']>().toEqualTypeOf<string>();
});

test('a route straight from k.routes is unbranded', () => {
    expectTypeOf<BrandedHandlerContext<typeof users.listUsers>>().toEqualTypeOf<{}>();
});

test('the standalone RouteHandler matches the Router tree it drops into', () => {
    expectTypeOf<RouteHandler<typeof nestedContract.routes.members.session.me, {}>>().toEqualTypeOf<
        NestedHandlers['members']['session']['me']
    >();
});

const inviteToken = Kizuna.identity.custom({
    context: z.object({
        inviteId: z.string(),
    }),
});

const inviteK = new Kizuna({
    identities: {
        inviteToken,
    },
});

const inviteContract = inviteK.contract({
    routes: {
        invites: inviteK.routes({
            getInvite: {
                method: 'GET',
                path: '/invites/:token',
                ...okResponse,
            },
        }),
    },
    auth: {
        invites: 'inviteToken',
    },
});

type InviteHandlers = HandlersFromAuth<
    typeof inviteContract.routes,
    {},
    NonNullable<typeof inviteContract.securitySchemes>,
    NonNullable<typeof inviteContract.auth>
>;

test('a custom identity carries no credential key to its guard', () => {
    expectTypeOf<CredentialOf<typeof inviteToken>>().toEqualTypeOf<{}>();
});

test('a custom-guarded route hands its context to the handler by name', () => {
    type Args = Parameters<InviteHandlers['invites']['getInvite']>[0];
    expectTypeOf<Args['auth']['inviteToken']>().toEqualTypeOf<{ inviteId: string }>();
});

test('a custom identity derives its guard params from the routes it secures', () => {
    type Params = GuardParams<typeof inviteContract.routes, NonNullable<typeof inviteContract.auth>, 'inviteToken'>;
    expectTypeOf<Params>().toEqualTypeOf<{ token?: string }>();
});
