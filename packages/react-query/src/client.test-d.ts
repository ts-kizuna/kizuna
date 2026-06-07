import { expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { createContract, type ValidationError } from '@ts-kizuna/core';
import { createClient } from './client.js';
import { KizunaHttpError } from './error.js';
import type { MutationNode, QueryNode } from './types.js';

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
                message: z.string(),
            }),
        },
    },
    describeUsers: {
        method: 'OPTIONS',
        path: '/users/describe',
        responses: {
            200: z.object({
                allow: z.string(),
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

const api = createClient(contract, {
    baseUrl: 'http://localhost',
});

test('GET/OPTIONS routes are query nodes, mutating routes are mutation nodes', () => {
    expectTypeOf(api.listUsers).toMatchTypeOf<QueryNode<(typeof contract)['listUsers']>>();
    expectTypeOf(api.getUser).toMatchTypeOf<QueryNode<(typeof contract)['getUser']>>();
    expectTypeOf(api.describeUsers).toMatchTypeOf<QueryNode<(typeof contract)['describeUsers']>>();
    expectTypeOf(api.createUser).toMatchTypeOf<MutationNode<(typeof contract)['createUser']>>();
});

test('useQuery data is the 2xx response; error is a typed KizunaHttpError', () => {
    const userQuery = api.getUser.useQuery({ params: { id: '1' } });
    expectTypeOf(userQuery.data).toEqualTypeOf<{ status: 200; body: { id: string }; headers: Record<string, string> } | undefined>();
    expectTypeOf(userQuery.error).toMatchTypeOf<KizunaHttpError | null>();
    expectTypeOf(userQuery.error?.status).toMatchTypeOf<404 | undefined>();
    expectTypeOf(userQuery.error?.body).toMatchTypeOf<{ message: string } | undefined>();
});

test('mutation data is the 2xx response; error includes the auto 400 ValidationError', () => {
    const mutation = api.createUser.useMutation();
    expectTypeOf(mutation.data).toEqualTypeOf<{ status: 201; body: { id: string }; headers: Record<string, string> } | undefined>();
    expectTypeOf(mutation.error).toMatchTypeOf<KizunaHttpError<ValidationError> | null>();
    expectTypeOf(mutation.mutate).parameter(0).toMatchTypeOf<{ body: { name: string } }>();
});

test('params is required only for routes with :param paths', () => {
    expectTypeOf(api.getUser.useQuery).parameter(0).toMatchTypeOf<{ params: { id: string } }>();
    api.listUsers.useQuery();
    api.listUsers.queryKey();
});

test('the full query surface is present', () => {
    expectTypeOf(api.listUsers.queryOptions).toBeFunction();
    expectTypeOf(api.listUsers.infiniteQueryOptions).toBeFunction();
    expectTypeOf(api.listUsers.useSuspenseQuery).toBeFunction();
    expectTypeOf(api.listUsers.useInfiniteQuery).toBeFunction();
    expectTypeOf(api.listUsers.useSuspenseInfiniteQuery).toBeFunction();
    expectTypeOf(api.listUsers.usePrefetchQuery).toBeFunction();
    expectTypeOf(api.listUsers.invalidate).toBeFunction();
    expectTypeOf(api.listUsers.prefetch).toBeFunction();
    expectTypeOf(api.listUsers.fetch).toBeFunction();
    expectTypeOf(api.listUsers.ensureData).toBeFunction();
    expectTypeOf(api.listUsers.getData).toBeFunction();
    expectTypeOf(api.listUsers.setData).toBeFunction();
    expectTypeOf(api.listUsers.refetch).toBeFunction();
    expectTypeOf(api.listUsers.cancel).toBeFunction();
    expectTypeOf(api.listUsers.remove).toBeFunction();
    expectTypeOf(api.listUsers.reset).toBeFunction();
});
