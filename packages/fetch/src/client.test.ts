import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createContract } from '@ts-kizuna/core';
import { createClient } from './client.js';

const contract = createContract({
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

const nestedContract = createContract({
    users: createContract({
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
    }),
    posts: createContract({
        listPosts: {
            method: 'GET',
            path: '/posts',
            responses: {
                200: z.object({
                    posts: z.array(z.string()),
                }),
            },
        },
    }),
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

    it('throws when baseUrl is not a full URL', () => {
        expect(() =>
            createClient(contract, {
                baseUrl: '/api',
            })
        ).toThrow(/baseUrl must be a full URL/);
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
        const [url, options] = call as [string, RequestInit & { headers: Record<string, string> }];
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

        const [, options] = fetchMock.mock.calls[0]! as [string, RequestInit & { headers: Record<string, string>; body: string }];
        expect(options.method).toBe('POST');
        expect(JSON.parse(options.body)).toEqual({
            name: 'Alice',
        });
        expect(options.headers['Content-Type']).toBe('application/json');
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

        const [, options] = fetchMock.mock.calls[0]! as [string, RequestInit & { headers: Record<string, string> }];
        expect(options.headers.Authorization).toBe('Bearer token123');
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

        const [, options] = fetchMock.mock.calls[0]! as [string, RequestInit & { headers: Record<string, string> }];
        expect(options.body).toBeInstanceOf(FormData);
        const form = options.body as FormData;
        expect(form.get('userId')).toBe('u1');
        const sent = form.get('file');
        expect(sent).toBeInstanceOf(File);
        expect(await (sent as File).text()).toBe('hello world');
        expect(options.headers['Content-Type']).toBeUndefined();
        expect(options.headers['content-type']).toBeUndefined();
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

        const [, options] = fetchMock.mock.calls[0]! as [string, RequestInit & { headers: Record<string, string>; body: URLSearchParams }];
        expect(options.body).toBeInstanceOf(URLSearchParams);
        expect(options.body.get('email')).toBe('alice@example.com');
        expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
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

        const [, options] = fetchMock.mock.calls[0]! as [string, RequestInit & { headers: Record<string, string>; body: string }];
        expect(typeof options.body).toBe('string');
        expect(options.headers['Content-Type']).toBe('application/json');
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

        const [, options] = fetchMock.mock.calls[0]! as [string, RequestInit & { headers: Record<string, string>; body: string }];
        expect(options.method).toBe('POST');
        expect(JSON.parse(options.body)).toEqual({
            name: 'Carol',
        });
        expect(options.headers['Content-Type']).toBe('application/json');
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
