import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { kizuna } from './kizuna.js';
import { createIdentity } from './identity.js';
import {
    createAdapter,
    extractCredential,
    renderJsonResult,
    resolveSecurityRequirements,
    type AdapterRequest,
    type AdapterResult,
    type GuardMap,
} from './adapter.js';
import type { RouteDefinition } from './types.js';

const user = createIdentity.bearer({
    context: z.object({
        userId: z.string(),
    }),
});

const member = createIdentity.apiKey({
    name: 'x-workspace-token',
    in: 'header',
    context: z.object({
        workspaceUserId: z.string(),
    }),
    access: z.object({
        role: z.enum(['owner', 'admin']),
    }),
});

const { k } = kizuna({
    identities: {
        user,
        member,
    },
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

const makeContract = () => {
    const routes = {
        items: k.routes({
            listItems: routeDefinition('/items'),
            getSecret: routeDefinition('/secret'),
            ownerOnly: routeDefinition('/owner-only'),
            scoped: routeDefinition('/scoped'),
        }),
    };
    return k.contract({
        routes,
        auth: {
            items: {
                '*': false,
                getSecret: 'user',
                ownerOnly: {
                    member: {
                        role: 'owner',
                    },
                },
                scoped: {
                    user: ['read:items'],
                },
            },
        },
    });
};

const makeRequest = (path: string, headers: Record<string, string> = {}): AdapterRequest<null> => ({
    request: null,
    method: 'GET',
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

const okHandler = () => ({
    status: 200 as const,
    body: {
        ok: true,
    },
});

describe('guard pipeline', () => {
    it('skips guards entirely on a public route', async () => {
        const contract = makeContract();
        const { adapter, results } = makeAdapter();
        let guardRan = false;
        const guards: GuardMap<Record<string, never>> = {
            user: () => {
                guardRan = true;
                return {};
            },
        };
        await adapter.handle({
            routes: contract.routes,
            router: {
                items: {
                    listItems: okHandler,
                    getSecret: okHandler,
                    ownerOnly: okHandler,
                    scoped: okHandler,
                },
            },
            request: makeRequest('/items'),
            responseContext: {},
            guards,
            schemes: contract.securitySchemes,
        });
        expect(guardRan).toBe(false);
        expect(results[0]?.kind).toBe('success');
    });

    it('passes the extracted bearer credential to the guard and its context to the handler', async () => {
        const contract = makeContract();
        const { adapter, results } = makeAdapter();
        let received: unknown;
        await adapter.handle({
            routes: contract.routes,
            router: {
                items: {
                    listItems: okHandler,
                    getSecret: (args: Record<string, unknown>) => {
                        received = (args.auth as Record<string, unknown>).user;
                        return okHandler();
                    },
                    ownerOnly: okHandler,
                    scoped: okHandler,
                },
            },
            request: makeRequest('/secret', {
                authorization: 'Bearer tok_ada',
            }),
            responseContext: {},
            guards: {
                user: ({ bearer }) => ({
                    userId: `id-for-${(bearer as { token: string }).token}`,
                }),
            } as GuardMap<Record<string, never>>,
            schemes: contract.securitySchemes,
        });
        expect(results[0]?.kind).toBe('success');
        expect(received).toEqual({
            userId: 'id-for-tok_ada',
        });
    });

    it('returns guard-denied when the guard denies', async () => {
        const contract = makeContract();
        const { adapter, results } = makeAdapter();
        await adapter.handle({
            routes: contract.routes,
            router: {
                items: {
                    listItems: okHandler,
                    getSecret: okHandler,
                    ownerOnly: okHandler,
                    scoped: okHandler,
                },
            },
            request: makeRequest('/secret'),
            responseContext: {},
            guards: {
                user: ({ deny }) => deny(401, 'Unauthorized'),
            } as GuardMap<Record<string, never>>,
            schemes: contract.securitySchemes,
        });
        expect(results[0]).toEqual({
            kind: 'guard-denied',
            status: 401,
            detail: 'Unauthorized',
        });
    });

    it('rejects with 403 when the access gate does not permit the guard result', async () => {
        const contract = makeContract();
        const { adapter, results } = makeAdapter();
        await adapter.handle({
            routes: contract.routes,
            router: {
                items: {
                    listItems: okHandler,
                    getSecret: okHandler,
                    ownerOnly: okHandler,
                    scoped: okHandler,
                },
            },
            request: makeRequest('/owner-only', {
                'x-workspace-token': 'wst_admin',
            }),
            responseContext: {},
            guards: {
                member: () => ({
                    workspaceUserId: '2',
                    role: 'admin',
                }),
            } as GuardMap<Record<string, never>>,
            schemes: contract.securitySchemes,
        });
        expect(results[0]?.kind).toBe('guard-denied');
        expect((results[0] as { status: number }).status).toBe(403);
    });

    it('passes the gate when the guard result is permitted and narrows nothing away', async () => {
        const contract = makeContract();
        const { adapter, results } = makeAdapter();
        let received: unknown;
        await adapter.handle({
            routes: contract.routes,
            router: {
                items: {
                    listItems: okHandler,
                    getSecret: okHandler,
                    ownerOnly: (args: Record<string, unknown>) => {
                        received = (args.auth as Record<string, unknown>).member;
                        return okHandler();
                    },
                    scoped: okHandler,
                },
            },
            request: makeRequest('/owner-only', {
                'x-workspace-token': 'wst_owner',
            }),
            responseContext: {},
            guards: {
                member: ({ apiKey }) => ({
                    workspaceUserId: (apiKey as { value: string }).value,
                    role: 'owner',
                }),
            } as GuardMap<Record<string, never>>,
            schemes: contract.securitySchemes,
        });
        expect(results[0]?.kind).toBe('success');
        expect(received).toEqual({
            workspaceUserId: 'wst_owner',
            role: 'owner',
        });
    });

    it('delivers the required scopes to the guard', async () => {
        const contract = makeContract();
        const { adapter } = makeAdapter();
        let receivedScopes: string[] | undefined;
        await adapter.handle({
            routes: contract.routes,
            router: {
                items: {
                    listItems: okHandler,
                    getSecret: okHandler,
                    ownerOnly: okHandler,
                    scoped: okHandler,
                },
            },
            request: makeRequest('/scoped', {
                authorization: 'Bearer tok',
            }),
            responseContext: {},
            guards: {
                user: ({ scopes }) => {
                    receivedScopes = scopes;
                    return {
                        userId: '1',
                    };
                },
            } as GuardMap<Record<string, never>>,
            schemes: contract.securitySchemes,
        });
        expect(receivedScopes).toEqual(['read:items']);
    });

    it('surfaces a missing guard as a handler error', async () => {
        const contract = makeContract();
        const { adapter, results } = makeAdapter();
        await adapter.handle({
            routes: contract.routes,
            router: {
                items: {
                    listItems: okHandler,
                    getSecret: okHandler,
                    ownerOnly: okHandler,
                    scoped: okHandler,
                },
            },
            request: makeRequest('/secret'),
            responseContext: {},
            guards: {},
            schemes: contract.securitySchemes,
        });
        expect(results[0]?.kind).toBe('handler-error');
    });

    it('renders guard-denied as RFC 9457 problem details', () => {
        const rendered = renderJsonResult({
            kind: 'guard-denied',
            status: 401,
            detail: 'Unauthorized',
        });
        expect(rendered.status).toBe(401);
        expect(rendered.headers['content-type']).toBe('application/problem+json');
        expect(rendered.body).toMatchObject({
            status: 401,
            detail: 'Unauthorized',
        });
    });
});

describe('resolveSecurityRequirements', () => {
    it('expands names and scoped entries', () => {
        const route = {
            ...routeDefinition('/x'),
            security: [
                'user',
                {
                    member: ['a', 'b'],
                },
            ],
        } as RouteDefinition;
        expect(resolveSecurityRequirements(route)).toEqual([
            {
                scheme: 'user',
                scopes: [],
            },
            {
                scheme: 'member',
                scopes: ['a', 'b'],
            },
        ]);
    });

    it('returns nothing for a public or unsecured route', () => {
        expect(resolveSecurityRequirements(routeDefinition('/x'))).toEqual([]);
        expect(
            resolveSecurityRequirements({
                ...routeDefinition('/x'),
                security: [],
            } as RouteDefinition)
        ).toEqual([]);
    });
});

describe('extractCredential', () => {
    const request = (headers: Record<string, string | string[]>, query: Record<string, unknown> = {}): AdapterRequest<null> => ({
        request: null,
        method: 'GET',
        resolution: {
            kind: 'core-match',
            path: '/x',
        },
        query,
        headers,
        readBody: () => undefined,
    });

    it('extracts a bearer token case-insensitively', () => {
        expect(extractCredential(user, request({ authorization: 'bearer abc' }))).toEqual({
            bearer: {
                token: 'abc',
            },
        });
    });

    it('yields null when the authorization header is absent or not bearer', () => {
        expect(extractCredential(user, request({}))).toEqual({
            bearer: null,
        });
        expect(extractCredential(user, request({ authorization: 'Basic abc' }))).toEqual({
            bearer: null,
        });
    });

    it('extracts an apiKey from its header', () => {
        expect(extractCredential(member, request({ 'x-workspace-token': 'wst_1' }))).toEqual({
            apiKey: {
                in: 'header',
                name: 'x-workspace-token',
                value: 'wst_1',
            },
        });
    });

    it('extracts an apiKey from a query parameter', () => {
        const queryKey = createIdentity.apiKey({
            name: 'api_key',
            in: 'query',
            context: z.object({}),
        });
        expect(extractCredential(queryKey, request({}, { api_key: 'qk_1' }))).toEqual({
            apiKey: {
                in: 'query',
                name: 'api_key',
                value: 'qk_1',
            },
        });
    });

    it('extracts an apiKey from a cookie', () => {
        const cookieKey = createIdentity.apiKey({
            name: 'session',
            in: 'cookie',
            context: z.object({}),
        });
        expect(extractCredential(cookieKey, request({ cookie: 'theme=dark; session=ck_1' }))).toEqual({
            apiKey: {
                in: 'cookie',
                name: 'session',
                value: 'ck_1',
            },
        });
    });

    it('decodes basic credentials and tolerates malformed input', () => {
        const admin = createIdentity.basic({
            context: z.object({}),
        });
        const encoded = Buffer.from('ada:secret').toString('base64');
        expect(extractCredential(admin, request({ authorization: `Basic ${encoded}` }))).toEqual({
            basic: {
                username: 'ada',
                password: 'secret',
            },
        });
        expect(extractCredential(admin, request({ authorization: 'Basic %%%not-base64%%%' }))).toEqual({
            basic: null,
        });
    });

    it('labels oauth2 and openIdConnect tokens by their scheme kind', () => {
        const oauthUser = createIdentity.oauth2({
            flows: {},
            context: z.object({}),
        });
        const oidcUser = createIdentity.openIdConnect({
            openIdConnectUrl: 'https://example.com/.well-known/openid-configuration',
            context: z.object({}),
        });
        expect(extractCredential(oauthUser, request({ authorization: 'Bearer t' }))).toEqual({
            oauth2: {
                token: 't',
            },
        });
        expect(extractCredential(oidcUser, request({ authorization: 'Bearer t' }))).toEqual({
            openIdConnect: {
                token: 't',
            },
        });
    });
});

describe('guard params and array gates', () => {
    const withParams = k.contract({
        routes: {
            items: k.routes({
                getWorkspaceUser: {
                    method: 'GET',
                    path: '/workspaces/:workspaceId/users/:id',
                    responses: {
                        200: z.object({
                            ok: z.boolean(),
                        }),
                    },
                },
            }),
        },
        auth: {
            items: 'user',
        },
    });

    it('passes the matched route params to the guard', async () => {
        const { adapter, results } = makeAdapter();
        let received: Record<string, string> | undefined;
        await adapter.handle({
            routes: withParams.routes,
            router: {
                items: {
                    getWorkspaceUser: okHandler,
                },
            },
            request: makeRequest('/workspaces/ws_1/users/42', {
                authorization: 'Bearer tok',
            }),
            responseContext: {},
            guards: {
                user: ({ params }) => {
                    received = params;
                    return {
                        userId: '1',
                    };
                },
            } as GuardMap<Record<string, never>>,
            schemes: withParams.securitySchemes,
        });
        expect(results[0]?.kind).toBe('success');
        expect(received).toEqual({
            workspaceId: 'ws_1',
            id: '42',
        });
    });

    const workspaceMember = createIdentity.apiKey({
        name: 'x-workspace-token',
        in: 'header',
        context: z.object({
            workspaceUserId: z.string(),
        }),
        access: z.object({
            permissions: z.array(z.enum(['invite', 'export'])),
        }),
    });

    const { k: permK } = kizuna({
        identities: {
            member: workspaceMember,
        },
    });

    const permContract = permK.contract({
        routes: {
            users: permK.routes({
                exportUsers: {
                    method: 'GET',
                    path: '/users/export',
                    responses: {
                        200: z.object({
                            ok: z.boolean(),
                        }),
                    },
                },
            }),
        },
        auth: {
            users: {
                member: {
                    permissions: 'export',
                },
            },
        },
    });

    const permRouter = {
        users: {
            exportUsers: okHandler,
        },
    };

    it('passes an array-field gate when the array contains the allowed value', async () => {
        const { adapter, results } = makeAdapter();
        await adapter.handle({
            routes: permContract.routes,
            router: permRouter,
            request: makeRequest('/users/export', {
                'x-workspace-token': 'tok',
            }),
            responseContext: {},
            guards: {
                member: () => ({
                    workspaceUserId: '1',
                    permissions: ['invite', 'export'],
                }),
            } as GuardMap<Record<string, never>>,
            schemes: permContract.securitySchemes,
        });
        expect(results[0]?.kind).toBe('success');
    });

    it('rejects an array-field gate when the value is missing', async () => {
        const { adapter, results } = makeAdapter();
        await adapter.handle({
            routes: permContract.routes,
            router: permRouter,
            request: makeRequest('/users/export', {
                'x-workspace-token': 'tok',
            }),
            responseContext: {},
            guards: {
                member: () => ({
                    workspaceUserId: '1',
                    permissions: ['invite'],
                }),
            } as GuardMap<Record<string, never>>,
            schemes: permContract.securitySchemes,
        });
        expect(results[0]?.kind).toBe('guard-denied');
        expect((results[0] as { status: number }).status).toBe(403);
    });
});
