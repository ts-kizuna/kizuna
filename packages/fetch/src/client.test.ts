import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { kizuna, createTags } from '@ts-kizuna/core';
import { createClient } from './client.js';

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
            200: {
                body: z.object({
                    id: z.string(),
                    name: z.string(),
                }),
                headers: z.object({
                    'x-request-id': z.string().optional(),
                }),
            },
        },
    },
    createUser: {
        method: 'POST',
        path: '/users',
        body: z.object({
            name: z.string(),
        }),
        responses: {
            201: z.object({
                id: z.string(),
                name: z.string(),
            }),
        },
    },
    listUsers: {
        method: 'GET',
        path: '/users',
        query: z.object({
            page: z.number().optional(),
        }),
        responses: {
            200: z.object({
                users: z.array(z.string()),
            }),
        },
    },
    uploadAvatar: {
        method: 'POST',
        path: '/avatar',
        contentType: 'multipart/form-data',
        body: z.object({
            file: z.instanceof(File),
            userId: z.string(),
        }),
        responses: {
            200: z.object({
                ok: z.boolean(),
            }),
        },
    },
    submitForm: {
        method: 'POST',
        path: '/form',
        contentType: 'application/x-www-form-urlencoded',
        body: z.object({
            email: z.string(),
        }),
        responses: {
            200: z.object({
                ok: z.boolean(),
            }),
        },
    },
});

const contract = k.contract({
    routes: contractRoutes,
});

const nestedContractRoutes = k.routes('api', {
    users: {
        getUser: {
            method: 'GET',
            path: '/users/:id',
            responses: {
                200: z.object({
                    id: z.string(),
                    name: z.string(),
                }),
            },
        },
        createUser: {
            method: 'POST',
            path: '/users',
            body: z.object({
                name: z.string(),
            }),
            responses: {
                201: z.object({
                    id: z.string(),
                    name: z.string(),
                }),
            },
        },
    },
    posts: {
        listPosts: {
            method: 'GET',
            path: '/posts',
            responses: {
                200: z.object({
                    posts: z.array(z.string()),
                }),
            },
        },
    },
});

const nestedContract = k.contract({
    routes: nestedContractRoutes,
});

const stubFetch = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    vi.fn().mockResolvedValue({
        status,
        text: () => Promise.resolve(JSON.stringify(body)),
        headers: {
            forEach: (callback: (value: string, key: string) => void) => {
                for (const [key, value] of Object.entries(headers)) callback(value, key);
            },
        },
    });

describe('createClient', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('builds correct URL for GET with path params', async () => {
        const fetchMock = stubFetch(200, {
            id: '123',
            name: 'Alice',
        });
        const client = createClient(contract, {
            baseUrl: 'http://localhost:3000',
            fetch: fetchMock,
        });

        await client.getUser({
            params: {
                id: '123',
            },
        });

        const call = fetchMock.mock.calls[0]!;
        const [url, options] = call as [string, RequestInit & { headers: Headers }];
        expect(url).toBe('http://localhost:3000/users/123');
        expect(options.method).toBe('GET');
    });

    it('preserves baseUrl path prefix', async () => {
        const fetchMock = stubFetch(200, {
            users: [],
        });
        const client = createClient(contract, {
            baseUrl: 'http://localhost:3000/api/v1',
            fetch: fetchMock,
        });

        await client.listUsers({
            query: {},
        });

        const [url] = fetchMock.mock.calls[0]! as [string];
        expect(url).toBe('http://localhost:3000/api/v1/users');
    });

    it('JSON-encodes the body and sets Content-Type', async () => {
        const fetchMock = stubFetch(201, {
            id: '1',
            name: 'Alice',
        });
        const client = createClient(contract, {
            baseUrl: 'http://localhost:3000',
            fetch: fetchMock,
        });

        await client.createUser({
            body: {
                name: 'Alice',
            },
        });

        const [, options] = fetchMock.mock.calls[0]! as [string, RequestInit & { headers: Headers; body: string }];
        expect(options.method).toBe('POST');
        expect(JSON.parse(options.body)).toEqual({
            name: 'Alice',
        });
        expect(options.headers.get('Content-Type')).toBe('application/json');
    });

    it('appends query parameters', async () => {
        const fetchMock = stubFetch(200, {
            users: [],
        });
        const client = createClient(contract, {
            baseUrl: 'http://localhost:3000',
            fetch: fetchMock,
        });

        await client.listUsers({
            query: {
                page: 2,
            },
        });

        const [url] = fetchMock.mock.calls[0]! as [string];
        expect(url).toContain('page=2');
    });

    it('returns the parsed status and body', async () => {
        const fetchMock = stubFetch(200, {
            id: '1',
            name: 'Alice',
        });
        const client = createClient(contract, {
            baseUrl: 'http://localhost:3000',
            fetch: fetchMock,
        });

        const result = await client.getUser({
            params: {
                id: '1',
            },
        });

        expect(result.status).toBe(200);
        expect(result.body).toEqual({
            id: '1',
            name: 'Alice',
        });
    });

    it('returns response headers from the fetch response', async () => {
        const fetchMock = stubFetch(200, { id: '1', name: 'Alice' }, { 'x-request-id': 'trace-123' });
        const client = createClient(contract, {
            baseUrl: 'http://localhost:3000',
            fetch: fetchMock,
        });

        const result = await client.getUser({
            params: {
                id: '1',
            },
        });

        expect(result.headers['x-request-id']).toBe('trace-123');
    });

    it('forwards baseHeaders', async () => {
        const fetchMock = stubFetch(200, {
            id: '1',
            name: 'Alice',
        });
        const client = createClient(contract, {
            baseUrl: 'http://localhost:3000',
            baseHeaders: {
                Authorization: 'Bearer token123',
            },
            fetch: fetchMock,
        });

        await client.getUser({
            params: {
                id: '1',
            },
        });

        const [, options] = fetchMock.mock.calls[0]! as [string, RequestInit & { headers: Headers }];
        expect(options.headers.get('Authorization')).toBe('Bearer token123');
    });

    it('serializes multipart/form-data body as FormData and omits Content-Type', async () => {
        const fetchMock = stubFetch(200, {
            ok: true,
        });
        const client = createClient(contract, {
            baseUrl: 'http://localhost:3000',
            fetch: fetchMock,
        });

        const file = new File(['hello world'], 'avatar.txt', {
            type: 'text/plain',
        });
        await client.uploadAvatar({
            body: {
                file,
                userId: 'u1',
            },
        });

        const [, options] = fetchMock.mock.calls[0]! as [string, RequestInit & { headers: Headers }];
        expect(options.body).toBeInstanceOf(FormData);
        const form = options.body as FormData;
        expect(form.get('userId')).toBe('u1');
        const sent = form.get('file');
        expect(sent).toBeInstanceOf(File);
        expect(await (sent as File).text()).toBe('hello world');
        expect(options.headers.get('Content-Type')).toBeNull();
        expect(options.headers.get('content-type')).toBeNull();
    });

    it('serializes application/x-www-form-urlencoded body as URLSearchParams', async () => {
        const fetchMock = stubFetch(200, {
            ok: true,
        });
        const client = createClient(contract, {
            baseUrl: 'http://localhost:3000',
            fetch: fetchMock,
        });

        await client.submitForm({
            body: {
                email: 'alice@example.com',
            },
        });

        const [, options] = fetchMock.mock.calls[0]! as [string, RequestInit & { headers: Headers; body: URLSearchParams }];
        expect(options.body).toBeInstanceOf(URLSearchParams);
        expect(options.body.get('email')).toBe('alice@example.com');
        expect(options.headers.get('Content-Type')).toBe('application/x-www-form-urlencoded');
    });

    it('still JSON-encodes when contentType is undefined (regression guard)', async () => {
        const fetchMock = stubFetch(201, {
            id: '1',
            name: 'Alice',
        });
        const client = createClient(contract, {
            baseUrl: 'http://localhost:3000',
            fetch: fetchMock,
        });

        await client.createUser({
            body: {
                name: 'Alice',
            },
        });

        const [, options] = fetchMock.mock.calls[0]! as [string, RequestInit & { headers: Headers; body: string }];
        expect(typeof options.body).toBe('string');
        expect(options.headers.get('Content-Type')).toBe('application/json');
    });
});

describe('createClient — onRequest', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('adds headers via onRequest before the fetch call', async () => {
        const fetchMock = stubFetch(200, { id: '1', name: 'Alice' });
        const client = createClient(contract, {
            baseUrl: 'http://localhost:3000',
            fetch: fetchMock,
            onRequest: ({ headers }) => {
                headers.set('Authorization', 'Bearer my-token');
            },
        });

        await client.getUser({ params: { id: '1' } });

        const [, options] = fetchMock.mock.calls[0]! as [string, RequestInit & { headers: Headers }];
        expect(options.headers.get('Authorization')).toBe('Bearer my-token');
    });

    it('supports async onRequest', async () => {
        const fetchMock = stubFetch(200, { id: '1', name: 'Alice' });
        const client = createClient(contract, {
            baseUrl: 'http://localhost:3000',
            fetch: fetchMock,
            onRequest: async ({ headers }) => {
                const token = await Promise.resolve('async-token');
                headers.set('Authorization', `Bearer ${token}`);
            },
        });

        await client.getUser({ params: { id: '1' } });

        const [, options] = fetchMock.mock.calls[0]! as [string, RequestInit & { headers: Headers }];
        expect(options.headers.get('Authorization')).toBe('Bearer async-token');
    });

    it('receives route metadata in onRequest', async () => {
        const fetchMock = stubFetch(200, { id: '1', name: 'Alice' });
        const receivedRoutes: string[] = [];
        const client = createClient(contract, {
            baseUrl: 'http://localhost:3000',
            fetch: fetchMock,
            onRequest: ({ route, method }) => {
                receivedRoutes.push(`${method} ${route.path}`);
            },
        });

        await client.getUser({ params: { id: '1' } });

        expect(receivedRoutes).toEqual(['GET /users/:id']);
    });

    it('merges onRequest headers with baseHeaders', async () => {
        const fetchMock = stubFetch(200, { id: '1', name: 'Alice' });
        const client = createClient(contract, {
            baseUrl: 'http://localhost:3000',
            baseHeaders: { 'X-App': 'test' },
            fetch: fetchMock,
            onRequest: ({ headers }) => {
                headers.set('Authorization', 'Bearer token');
            },
        });

        await client.getUser({ params: { id: '1' } });

        const [, options] = fetchMock.mock.calls[0]! as [string, RequestInit & { headers: Headers }];
        expect(options.headers.get('X-App')).toBe('test');
        expect(options.headers.get('Authorization')).toBe('Bearer token');
    });
});

describe('createClient — nested routers', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('builds correct URL for a route inside a nested router', async () => {
        const fetchMock = stubFetch(200, {
            id: '42',
            name: 'Bob',
        });
        const client = createClient(nestedContract, {
            baseUrl: 'http://localhost:3000',
            fetch: fetchMock,
        });

        await client.users.getUser({
            params: {
                id: '42',
            },
        });

        const [url, options] = fetchMock.mock.calls[0]! as [string, RequestInit];
        expect(url).toBe('http://localhost:3000/users/42');
        expect(options.method).toBe('GET');
    });

    it('JSON-encodes body for a POST route inside a nested router', async () => {
        const fetchMock = stubFetch(201, {
            id: '1',
            name: 'Carol',
        });
        const client = createClient(nestedContract, {
            baseUrl: 'http://localhost:3000',
            fetch: fetchMock,
        });

        await client.users.createUser({
            body: {
                name: 'Carol',
            },
        });

        const [, options] = fetchMock.mock.calls[0]! as [string, RequestInit & { headers: Headers; body: string }];
        expect(options.method).toBe('POST');
        expect(JSON.parse(options.body)).toEqual({
            name: 'Carol',
        });
        expect(options.headers.get('Content-Type')).toBe('application/json');
    });

    it('resolves a sibling sub-router independently', async () => {
        const fetchMock = stubFetch(200, {
            posts: ['hello', 'world'],
        });
        const client = createClient(nestedContract, {
            baseUrl: 'http://localhost:3000',
            fetch: fetchMock,
        });

        const result = await client.posts.listPosts();

        const [url, options] = fetchMock.mock.calls[0]! as [string, RequestInit];
        expect(url).toBe('http://localhost:3000/posts');
        expect(options.method).toBe('GET');
        expect(result.status).toBe(200);
        expect(result.body).toEqual({
            posts: ['hello', 'world'],
        });
    });
});

describe('createClient — relative baseUrl', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('builds a relative URL with path params', async () => {
        const fetchMock = stubFetch(200, {
            id: '123',
            name: 'Alice',
        });
        const client = createClient(contract, {
            baseUrl: '/api',
            fetch: fetchMock,
        });

        await client.getUser({
            params: {
                id: '123',
            },
        });

        const [url] = fetchMock.mock.calls[0]! as [string];
        expect(url).toBe('/api/users/123');
    });

    it('appends query params to a relative URL', async () => {
        const fetchMock = stubFetch(200, {
            users: [],
        });
        const client = createClient(contract, {
            baseUrl: '/api',
            fetch: fetchMock,
        });

        await client.listUsers({
            query: {
                page: 2,
            },
        });

        const [url] = fetchMock.mock.calls[0]! as [string];
        expect(url).toBe('/api/users?page=2');
    });

    it('works with an empty baseUrl', async () => {
        const fetchMock = stubFetch(200, {
            id: '1',
            name: 'Alice',
        });
        const client = createClient(contract, {
            baseUrl: '',
            fetch: fetchMock,
        });

        await client.getUser({
            params: {
                id: '1',
            },
        });

        const [url] = fetchMock.mock.calls[0]! as [string];
        expect(url).toBe('/users/1');
    });

    it('preserves a relative baseUrl path prefix with path params', async () => {
        const fetchMock = stubFetch(200, {
            id: '42',
            name: 'Bob',
        });
        const client = createClient(contract, {
            baseUrl: '/api/v1',
            fetch: fetchMock,
        });

        await client.getUser({
            params: {
                id: '42',
            },
        });

        const [url] = fetchMock.mock.calls[0]! as [string];
        expect(url).toBe('/api/v1/users/42');
    });

    it('provides the correct url string in onRequest', async () => {
        const fetchMock = stubFetch(200, {
            id: '1',
            name: 'Alice',
        });
        let receivedUrl = '';
        const client = createClient(contract, {
            baseUrl: '/api',
            fetch: fetchMock,
            onRequest: ({ url }) => {
                receivedUrl = url;
            },
        });

        await client.getUser({
            params: {
                id: '1',
            },
        });

        expect(receivedUrl).toBe('/api/users/1');
    });
});
