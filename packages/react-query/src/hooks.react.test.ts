// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { z } from 'zod';
import { createContract } from '@ts-kizuna/core';
import { createClient } from './client.js';
import { KizunaHttpError } from './error.js';

const contract = createContract({
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
});

const stubFetch = (status: number, body: unknown) =>
    vi.fn(() =>
        Promise.resolve({
            status,
            text: () => Promise.resolve(JSON.stringify(body)),
            headers: {
                forEach: () => {},
            },
        } as unknown as Response)
    ) as unknown as typeof fetch;

const renderInClient = <Result>(hook: () => Result) => {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
            mutations: {
                retry: false,
            },
        },
    });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children);
    return { queryClient, ...renderHook(hook, { wrapper }) };
};

describe('hooks', () => {
    it('useQuery resolves the 2xx response into data', async () => {
        const api = createClient(contract, { baseUrl: 'http://localhost', fetch: stubFetch(200, { id: 'usr_1' }) });
        const { result } = renderInClient(() => api.getUser.useQuery({ params: { id: 'usr_1' } }));

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual({ status: 200, body: { id: 'usr_1' }, headers: {} });
    });

    it('useQuery surfaces a non-2xx response as a KizunaHttpError', async () => {
        const api = createClient(contract, { baseUrl: 'http://localhost', fetch: stubFetch(404, { detail: 'nope' }) });
        const { result } = renderInClient(() => api.getUser.useQuery({ params: { id: 'missing' } }));

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error).toBeInstanceOf(KizunaHttpError);
        expect(result.current.error?.status).toBe(404);
        expect(result.current.error?.body).toEqual({ detail: 'nope' });
    });

    it('useMutation posts the variables and resolves data', async () => {
        const api = createClient(contract, { baseUrl: 'http://localhost', fetch: stubFetch(201, { id: 'usr_2' }) });
        const { result } = renderInClient(() => api.createUser.useMutation());

        result.current.mutate({ body: { name: 'Alice' } });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual({ status: 201, body: { id: 'usr_2' }, headers: {} });
    });
});
