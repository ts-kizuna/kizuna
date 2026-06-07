import { describe, expect, it, vi } from 'vitest';
import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { createContract } from '@ts-kizuna/core';
import { createClient } from './client.js';

const contract = createContract({
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
    getUser: {
        method: 'GET',
        path: '/users/:id',
        responses: {
            200: z.object({
                id: z.string(),
            }),
            404: z.object({
                detail: z.string(),
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
            }),
        },
    },
    workspace: createContract({
        getInfo: {
            method: 'GET',
            path: '/workspace',
            responses: {
                200: z.object({
                    id: z.string(),
                }),
            },
        },
    }),
});

const stubFetch = (status: number, body: unknown) => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchFn = vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return Promise.resolve({
            status,
            text: () => Promise.resolve(JSON.stringify(body)),
            headers: {
                forEach: () => {},
            },
        } as unknown as Response);
    });
    return { fetchFn: fetchFn as unknown as typeof fetch, calls };
};

const makeQueryClient = () =>
    new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
            mutations: {
                retry: false,
            },
        },
    });

describe('createClient', () => {
    it('maps GET/HEAD routes to query nodes and others to mutation nodes', () => {
        const { fetchFn } = stubFetch(200, {});
        const api = createClient(contract, { baseUrl: 'http://localhost', fetch: fetchFn });

        expect(typeof api.listUsers.useQuery).toBe('function');
        expect(typeof api.listUsers.queryOptions).toBe('function');
        expect(typeof api.listUsers.queryKey).toBe('function');
        expect(typeof api.createUser.useMutation).toBe('function');
        expect(typeof api.createUser.mutationOptions).toBe('function');
        expect(typeof api.workspace.getInfo.useQuery).toBe('function');
    });

    it('builds hierarchical query keys including params and query', () => {
        const { fetchFn } = stubFetch(200, {});
        const api = createClient(contract, { baseUrl: 'http://localhost', fetch: fetchFn });

        expect(api.listUsers.queryKey({ query: { page: 2 } })).toEqual(['listUsers', { params: undefined, query: { page: 2 } }]);
        expect(api.getUser.queryKey({ params: { id: '1' } })).toEqual(['getUser', { params: { id: '1' }, query: undefined }]);
        expect(api.workspace.getInfo.queryKey()).toEqual(['workspace', 'getInfo', { params: undefined, query: undefined }]);
    });

    it('mutation keys are the contract path', () => {
        const { fetchFn } = stubFetch(201, {});
        const api = createClient(contract, { baseUrl: 'http://localhost', fetch: fetchFn });

        expect(api.createUser.mutationKey()).toEqual(['createUser']);
    });

    it('resolves the 2xx response as data via the underlying fetch client', async () => {
        const { fetchFn, calls } = stubFetch(200, { id: 'usr_1' });
        const api = createClient(contract, { baseUrl: 'http://localhost', fetch: fetchFn });

        const data = await makeQueryClient().fetchQuery(api.getUser.queryOptions({ params: { id: 'usr_1' } }));

        expect(calls[0]?.url).toBe('http://localhost/users/usr_1');
        expect(data).toEqual({ status: 200, body: { id: 'usr_1' }, headers: {} });
    });

    it('throws the response on a non-2xx status so it lands in error', async () => {
        const { fetchFn } = stubFetch(404, { detail: 'not found' });
        const api = createClient(contract, { baseUrl: 'http://localhost', fetch: fetchFn });

        await expect(makeQueryClient().fetchQuery(api.getUser.queryOptions({ params: { id: 'missing' } }))).rejects.toEqual({
            status: 404,
            body: { detail: 'not found' },
            headers: {},
        });
    });

    it('forwards an AbortSignal into the fetch call', async () => {
        const { fetchFn, calls } = stubFetch(200, { users: [] });
        const api = createClient(contract, { baseUrl: 'http://localhost', fetch: fetchFn });

        await makeQueryClient().fetchQuery(api.listUsers.queryOptions());

        expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
    });

    it('runs mutations through the underlying fetch client with the variables as the request', async () => {
        const { fetchFn, calls } = stubFetch(201, { id: 'usr_2' });
        const api = createClient(contract, { baseUrl: 'http://localhost', fetch: fetchFn });

        const observer = new MutationObserver(makeQueryClient(), api.createUser.mutationOptions());
        const data = await observer.mutate({ body: { name: 'Alice' } });

        expect(calls[0]?.url).toBe('http://localhost/users');
        expect(calls[0]?.init?.method).toBe('POST');
        expect(calls[0]?.init?.body).toBe(JSON.stringify({ name: 'Alice' }));
        expect(data).toEqual({ status: 201, body: { id: 'usr_2' }, headers: {} });
    });
});
