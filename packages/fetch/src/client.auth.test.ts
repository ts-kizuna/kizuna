import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { kizuna, createTags, createIdentity } from '@ts-kizuna/core';
import { createClient } from './client.js';

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
});

const queryKey = createIdentity.apiKey({
    name: 'api_key',
    in: 'query',
});

const cookieKey = createIdentity.apiKey({
    name: 'sid',
    in: 'cookie',
});

const admin = createIdentity.basic({
    context: z.object({
        adminId: z.string(),
    }),
});

const inviteToken = createIdentity.custom({
    context: z.object({
        inviteId: z.string(),
    }),
});

const { k } = kizuna({
    identities: {
        user,
        member,
        queryKey,
        cookieKey,
        admin,
        inviteToken,
    },
    tags: createTags({
        api: 'API',
    }),
});

const routes = k.routes('api', {
    bearerRoute: {
        method: 'GET',
        path: '/bearer',
        responses: {
            200: z.object({ ok: z.boolean() }),
        },
    },
    headerRoute: {
        method: 'GET',
        path: '/header',
        responses: {
            200: z.object({ ok: z.boolean() }),
        },
    },
    queryRoute: {
        method: 'GET',
        path: '/query',
        query: z.object({
            page: z.number().optional(),
        }),
        responses: {
            200: z.object({ ok: z.boolean() }),
        },
    },
    cookieRoute: {
        method: 'GET',
        path: '/cookie',
        responses: {
            200: z.object({ ok: z.boolean() }),
        },
    },
    basicRoute: {
        method: 'GET',
        path: '/basic',
        responses: {
            200: z.object({ ok: z.boolean() }),
        },
    },
    inviteRoute: {
        method: 'GET',
        path: '/invites/:token',
        responses: {
            200: z.object({ ok: z.boolean() }),
        },
    },
    publicRoute: {
        method: 'GET',
        path: '/public',
        responses: {
            200: z.object({ ok: z.boolean() }),
        },
    },
});

const auth = k.auth(routes, {
    bearerRoute: 'user',
    headerRoute: 'member',
    queryRoute: 'queryKey',
    cookieRoute: 'cookieKey',
    basicRoute: 'admin',
    inviteRoute: 'inviteToken',
    publicRoute: false,
});

const contract = k.contract({
    routes,
    auth,
});

const stubFetch = (status: number, body: unknown) =>
    vi.fn().mockResolvedValue({
        status,
        text: () => Promise.resolve(JSON.stringify(body)),
        headers: {
            forEach: () => {},
        },
    });

const requestHeaders = (fetchMock: ReturnType<typeof stubFetch>): Headers =>
    (fetchMock.mock.calls[0]! as [string, RequestInit & { headers: Headers }])[1].headers;

const requestUrl = (fetchMock: ReturnType<typeof stubFetch>): string => (fetchMock.mock.calls[0]! as [string])[0];

const fullAuth = {
    user: () => 'token-abc',
    member: () => 'ws-token',
    queryKey: () => 'secret',
    cookieKey: () => 'session-1',
    admin: () => ({ username: 'ci', password: 'pw' }),
};

describe('createClient auth', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('attaches a bearer token as Authorization: Bearer', async () => {
        const fetchMock = stubFetch(200, { ok: true });
        const client = createClient(contract, {
            baseUrl: 'http://localhost:3000',
            fetch: fetchMock,
            auth: fullAuth,
        });

        await client.bearerRoute();

        expect(requestHeaders(fetchMock).get('Authorization')).toBe('Bearer token-abc');
    });

    it('attaches an apiKey to its declared header', async () => {
        const fetchMock = stubFetch(200, { ok: true });
        const client = createClient(contract, {
            baseUrl: 'http://localhost:3000',
            fetch: fetchMock,
            auth: fullAuth,
        });

        await client.headerRoute();

        expect(requestHeaders(fetchMock).get('x-workspace-token')).toBe('ws-token');
    });

    it('attaches an apiKey to the query string, merged with route query', async () => {
        const fetchMock = stubFetch(200, { ok: true });
        const client = createClient(contract, {
            baseUrl: 'http://localhost:3000',
            fetch: fetchMock,
            auth: fullAuth,
        });

        await client.queryRoute({
            query: {
                page: 2,
            },
        });

        const url = requestUrl(fetchMock);
        expect(url).toContain('page=2');
        expect(url).toContain('api_key=secret');
    });

    it('attaches an apiKey to the Cookie header', async () => {
        const fetchMock = stubFetch(200, { ok: true });
        const client = createClient(contract, {
            baseUrl: 'http://localhost:3000',
            fetch: fetchMock,
            auth: fullAuth,
        });

        await client.cookieRoute();

        expect(requestHeaders(fetchMock).get('Cookie')).toBe('sid=session-1');
    });

    it('encodes basic credentials as Authorization: Basic', async () => {
        const fetchMock = stubFetch(200, { ok: true });
        const client = createClient(contract, {
            baseUrl: 'http://localhost:3000',
            fetch: fetchMock,
            auth: fullAuth,
        });

        await client.basicRoute();

        expect(requestHeaders(fetchMock).get('Authorization')).toBe(`Basic ${btoa('ci:pw')}`);
    });

    it('sends no credential when a provider returns null', async () => {
        const fetchMock = stubFetch(401, { title: 'Unauthorized' });
        const client = createClient(contract, {
            baseUrl: 'http://localhost:3000',
            fetch: fetchMock,
            auth: {
                ...fullAuth,
                user: () => null,
            },
        });

        await client.bearerRoute();

        expect(requestHeaders(fetchMock).get('Authorization')).toBeNull();
    });

    it('awaits async providers', async () => {
        const fetchMock = stubFetch(200, { ok: true });
        const client = createClient(contract, {
            baseUrl: 'http://localhost:3000',
            fetch: fetchMock,
            auth: {
                ...fullAuth,
                user: async () => 'async-token',
            },
        });

        await client.bearerRoute();

        expect(requestHeaders(fetchMock).get('Authorization')).toBe('Bearer async-token');
    });

    it('attaches nothing on a public route', async () => {
        const fetchMock = stubFetch(200, { ok: true });
        const client = createClient(contract, {
            baseUrl: 'http://localhost:3000',
            fetch: fetchMock,
            auth: fullAuth,
        });

        await client.publicRoute();

        expect(requestHeaders(fetchMock).get('Authorization')).toBeNull();
    });

    it('does not place a custom identity credential', async () => {
        const fetchMock = stubFetch(200, { ok: true });
        const client = createClient(contract, {
            baseUrl: 'http://localhost:3000',
            fetch: fetchMock,
            auth: fullAuth,
        });

        await client.inviteRoute({
            params: {
                token: 'invite-1',
            },
        });

        const url = requestUrl(fetchMock);
        expect(url).toBe('http://localhost:3000/invites/invite-1');
        expect(requestHeaders(fetchMock).get('Authorization')).toBeNull();
    });

    it('lets an explicit per-call header override the credential', async () => {
        const fetchMock = stubFetch(200, { ok: true });
        const client = createClient(contract, {
            baseUrl: 'http://localhost:3000',
            fetch: fetchMock,
            auth: fullAuth,
        });

        await client.headerRoute({
            headers: {
                'x-workspace-token': 'override',
            },
        });

        expect(requestHeaders(fetchMock).get('x-workspace-token')).toBe('override');
    });
});
