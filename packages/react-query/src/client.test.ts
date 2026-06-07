import { describe, expect, it, vi } from 'vitest';
import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { createContract } from '@ts-kizuna/core';
import { createClient } from './client.js';
import { KizunaHttpError } from './error.js';

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

const makeApi = (status: number, body: unknown) => {
    const { fetchFn, calls } = stubFetch(status, body);
    const api = createClient(contract, { baseUrl: 'http://localhost', fetch: fetchFn });
    return { api, calls };
};

describe('createClient', () => {
    it('exposes the full query surface on GET routes and the mutation surface on others', () => {
        const { api } = makeApi(200, {});

        for (const method of [
            'queryKey',
            'queryOptions',
            'infiniteQueryOptions',
            'useQuery',
            'useSuspenseQuery',
            'usePrefetchQuery',
            'useInfiniteQuery',
            'fetch',
            'prefetch',
            'ensureData',
            'getData',
            'setData',
            'invalidate',
            'refetch',
            'cancel',
            'remove',
            'reset',
        ] as const) {
            expect(typeof api.listUsers[method]).toBe('function');
        }
        expect(typeof api.createUser.useMutation).toBe('function');
        expect(typeof api.createUser.mutationOptions).toBe('function');
        expect(typeof api.workspace.getInfo.useQuery).toBe('function');
    });

    it('builds hierarchical query keys and contract-path mutation keys', () => {
        const { api } = makeApi(200, {});

        expect(api.listUsers.queryKey({ query: { page: 2 } })).toEqual(['listUsers', { params: undefined, query: { page: 2 } }]);
        expect(api.workspace.getInfo.queryKey()).toEqual(['workspace', 'getInfo', { params: undefined, query: undefined }]);
        expect(api.createUser.mutationKey()).toEqual(['createUser']);
    });

    it('fetch resolves the 2xx response via the underlying fetch client', async () => {
        const { api, calls } = makeApi(200, { id: 'usr_1' });

        const data = await api.getUser.fetch(makeQueryClient(), { params: { id: 'usr_1' } });

        expect(calls[0]?.url).toBe('http://localhost/users/usr_1');
        expect(data).toEqual({ status: 200, body: { id: 'usr_1' }, headers: {} });
    });

    it('throws a KizunaHttpError carrying the response on a non-2xx status', async () => {
        const { api } = makeApi(404, { detail: 'not found' });

        const error = await api.getUser.fetch(makeQueryClient(), { params: { id: 'missing' } }).catch((caught) => caught);

        expect(error).toBeInstanceOf(KizunaHttpError);
        expect(error.status).toBe(404);
        expect(error.body).toEqual({ detail: 'not found' });
        expect(error.message).toBe('HTTP 404');
    });

    it('forwards an AbortSignal into the fetch call', async () => {
        const { api, calls } = makeApi(200, { users: [] });

        await api.listUsers.fetch(makeQueryClient());

        expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
    });

    it('disambiguates options from args on no-arg query routes', async () => {
        const { api, calls } = makeApi(200, { id: 'ws_1' });
        const queryClient = makeQueryClient();

        // passing options (not args) as the first argument must not be treated as args
        await api.workspace.getInfo.fetch(queryClient, { staleTime: 1000 } as never);

        expect(calls[0]?.url).toBe('http://localhost/workspace');
    });

    it('getData/setData round-trip against the keyed cache', () => {
        const { api } = makeApi(200, {});
        const queryClient = makeQueryClient();

        expect(api.getUser.getData(queryClient, { params: { id: '1' } })).toBeUndefined();
        api.getUser.setData(queryClient, { params: { id: '1' } }, { status: 200, body: { id: '1' }, headers: {} });
        expect(api.getUser.getData(queryClient, { params: { id: '1' } })).toEqual({ status: 200, body: { id: '1' }, headers: {} });
    });

    it('invalidate without args matches every instance of the route', async () => {
        const { api } = makeApi(200, {});
        const queryClient = makeQueryClient();
        const spy = vi.spyOn(queryClient, 'invalidateQueries');

        await api.getUser.invalidate(queryClient);

        expect(spy).toHaveBeenCalledWith({ queryKey: ['getUser'] }, undefined);
    });

    it('runs mutations through the fetch client with the variables as the request', async () => {
        const { api, calls } = makeApi(201, { id: 'usr_2' });

        const observer = new MutationObserver(makeQueryClient(), api.createUser.mutationOptions());
        const data = await observer.mutate({ body: { name: 'Alice' } });

        expect(calls[0]?.url).toBe('http://localhost/users');
        expect(calls[0]?.init?.method).toBe('POST');
        expect(calls[0]?.init?.body).toBe(JSON.stringify({ name: 'Alice' }));
        expect(data).toEqual({ status: 201, body: { id: 'usr_2' }, headers: {} });
    });
});
