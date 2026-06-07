import { expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { createContract, type ValidationError } from '@ts-kizuna/core';
import { createClient } from './client.js';
import type { MutationNode, QueryNode } from './client.js';

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

test('GET routes are query nodes, non-GET routes are mutation nodes', () => {
    expectTypeOf(api.listUsers).toMatchTypeOf<QueryNode<(typeof contract)['listUsers']>>();
    expectTypeOf(api.getUser).toMatchTypeOf<QueryNode<(typeof contract)['getUser']>>();
    expectTypeOf(api.createUser).toMatchTypeOf<MutationNode<(typeof contract)['createUser']>>();
});

test('useQuery data is the 2xx union; error is the non-2xx union', () => {
    const userQuery = api.getUser.useQuery({ params: { id: '1' } });
    expectTypeOf(userQuery.data).toEqualTypeOf<{ status: 200; body: { id: string }; headers: Record<string, string> } | undefined>();
    expectTypeOf(userQuery.error).toEqualTypeOf<{ status: 404; body: { message: string }; headers: Record<string, string> } | null>();
});

test('mutation data is the 2xx response; error includes the auto 400 ValidationError', () => {
    const mutation = api.createUser.useMutation();
    expectTypeOf(mutation.data).toEqualTypeOf<{ status: 201; body: { id: string }; headers: Record<string, string> } | undefined>();
    expectTypeOf(mutation.error).toMatchTypeOf<{ status: 400; body: ValidationError } | null>();
});

test('params is required only for routes with :param paths', () => {
    // getUser has :id — args (with params) required
    expectTypeOf(api.getUser.useQuery).parameter(0).toMatchTypeOf<{ params: { id: string } }>();
    // listUsers has no path params and only optional query — args optional
    api.listUsers.useQuery();
    api.listUsers.queryKey();
});

test('mutation variables are the route ClientArgs', () => {
    const mutation = api.createUser.useMutation();
    expectTypeOf(mutation.mutate).parameter(0).toMatchTypeOf<{ body: { name: string } }>();
});
