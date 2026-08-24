import { expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { useInfiniteQuery as useVueInfiniteQuery, useMutation as useVueMutation, useQuery as useVueQuery } from '@tanstack/vue-query';
import { createInfiniteQuery, createMutation, createQuery } from '@tanstack/svelte-query';
import { Kizuna } from '@ts-kizuna/core';
import { KizunaClient } from '@ts-kizuna/fetch';
import { KizunaTanstackQuery } from './proxy.js';

const k = new Kizuna({
    groups: Kizuna.groups({
        users: 'Users',
    }),
});

const UserSchema = z.object({
    id: z.string(),
    name: z.string(),
});

const routes = k.routes.users({
    listUsers: {
        method: 'GET',
        path: '/users',
        responses: {
            200: z.object({
                users: z.array(UserSchema),
            }),
        },
    },
    getUser: {
        method: 'GET',
        path: '/users/:id',
        responses: {
            200: UserSchema,
            404: z.object({
                title: z.string(),
            }),
        },
    },
    searchUsers: {
        method: 'GET',
        path: '/users/search',
        query: z.object({
            term: z.string(),
            cursor: z.number().optional(),
        }),
        responses: {
            200: z.object({
                users: z.array(UserSchema),
                nextCursor: z.number().nullable(),
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
            201: UserSchema,
        },
    },
});

const contract = k.contract({
    routes: {
        users: routes,
    },
});

const apiClient = new KizunaClient(contract, {
    baseUrl: 'http://localhost:8000',
});

const api = new KizunaTanstackQuery(contract, apiClient);

type GetUserResponse = Awaited<ReturnType<typeof apiClient.users.getUser>>;
type SearchUsersResponse = Awaited<ReturnType<typeof apiClient.users.searchUsers>>;
type CreateUserArgs = Parameters<typeof apiClient.users.createUser>[0];

// `toEqualTypeOf` resolves the deferred response union to `never` on both sides.
const assignableBothWays = <T>(_forward: T, _backward: T): void => {};

test('react: data is the declared response union', () => {
    const query = useQuery(
        api.users.getUser.queryOptions({
            input: {
                params: {
                    id: '1',
                },
            },
        })
    );

    assignableBothWays<GetUserResponse | undefined>(query.data, query.data);
});

test('react: initialData narrows data to always defined', () => {
    const query = useQuery(
        api.users.getUser.queryOptions({
            input: {
                params: {
                    id: '1',
                },
            },
            initialData: {
                status: 200,
                body: {
                    id: '1',
                    name: 'Ada',
                },
                headers: {},
            },
        })
    );

    assignableBothWays<GetUserResponse>(query.data, query.data);
});

test('react: select transforms data and types its parameter', () => {
    const query = useQuery(
        api.users.getUser.queryOptions({
            input: {
                params: {
                    id: '1',
                },
            },
            select: (response) => {
                assignableBothWays<GetUserResponse>(response, response);
                return response.status;
            },
        })
    );

    expectTypeOf(query.data).toEqualTypeOf<200 | 404 | undefined>();
});

test('react: a route with no required arguments takes no input', () => {
    const query = useQuery(api.users.listUsers.queryOptions({}));

    expectTypeOf(query.data).toEqualTypeOf<
        { status: 200; body: { users: { id: string; name: string }[] }; headers: Record<string, string> } | undefined
    >();
});

test('react: mutation variables are the route arguments', () => {
    const mutation = useMutation(api.users.createUser.mutationOptions());

    assignableBothWays<CreateUserArgs>(mutation.variables!, mutation.variables!);
});

test('react: infinite options carry the page union', () => {
    const query = useInfiniteQuery(
        api.users.searchUsers.infiniteOptions({
            input: (cursor: number | undefined) => ({
                query: {
                    term: 'ada',
                    cursor,
                },
            }),
            initialPageParam: undefined,
            getNextPageParam: (lastPage) => (lastPage.status === 200 ? lastPage.body.nextCursor : null),
        })
    );

    assignableBothWays<SearchUsersResponse[] | undefined>(query.data?.pages, query.data?.pages);
});

// Vue Query takes its options as `MaybeRefDeep`, a mapped type that walks every property.
test('vue: data is the declared response union', () => {
    const query = useVueQuery(
        api.users.getUser.queryOptions({
            input: {
                params: {
                    id: '1',
                },
            },
        })
    );

    assignableBothWays<GetUserResponse | undefined>(query.data.value, query.data.value);
});

test('vue: select transforms data and types its parameter', () => {
    const query = useVueQuery(
        api.users.getUser.queryOptions({
            input: {
                params: {
                    id: '1',
                },
            },
            select: (response) => {
                assignableBothWays<GetUserResponse>(response, response);
                return response.status;
            },
        })
    );

    expectTypeOf(query.data.value).toEqualTypeOf<200 | 404 | undefined>();
});

test('vue: a route with a required query demands input', () => {
    // @ts-expect-error searchUsers declares a required `term`
    useVueQuery(api.users.searchUsers.queryOptions({}));
});

test('vue: mutation variables are the route arguments', () => {
    const mutation = useVueMutation(api.users.createUser.mutationOptions());

    assignableBothWays<CreateUserArgs>(mutation.variables.value!, mutation.variables.value!);
});

test('vue: infinite options carry the page union', () => {
    const query = useVueInfiniteQuery(
        api.users.searchUsers.infiniteOptions({
            input: (cursor: number | undefined) => ({
                query: {
                    term: 'ada',
                    cursor,
                },
            }),
            initialPageParam: undefined,
            getNextPageParam: (lastPage) => (lastPage.status === 200 ? lastPage.body.nextCursor : null),
        })
    );

    assignableBothWays<SearchUsersResponse[] | undefined>(query.data.value?.pages, query.data.value?.pages);
});

// Svelte Query takes an accessor rather than the options object itself.
test('svelte: data is the declared response union', () => {
    const query = createQuery(() =>
        api.users.getUser.queryOptions({
            input: {
                params: {
                    id: '1',
                },
            },
        })
    );

    assignableBothWays<GetUserResponse | undefined>(query.data, query.data);
});

test('svelte: select transforms data and types its parameter', () => {
    const query = createQuery(() =>
        api.users.getUser.queryOptions({
            input: {
                params: {
                    id: '1',
                },
            },
            select: (response) => {
                assignableBothWays<GetUserResponse>(response, response);
                return response.status;
            },
        })
    );

    expectTypeOf(query.data).toEqualTypeOf<200 | 404 | undefined>();
});

test('svelte: a route with a required query demands input', () => {
    // @ts-expect-error searchUsers declares a required `term`
    createQuery(() => api.users.searchUsers.queryOptions({}));
});

test('svelte: mutation variables are the route arguments', () => {
    const mutation = createMutation(() => api.users.createUser.mutationOptions());

    assignableBothWays<CreateUserArgs>(mutation.variables!, mutation.variables!);
});

test('svelte: infinite options carry the page union', () => {
    const query = createInfiniteQuery(() =>
        api.users.searchUsers.infiniteOptions({
            input: (cursor: number | undefined) => ({
                query: {
                    term: 'ada',
                    cursor,
                },
            }),
            initialPageParam: undefined,
            getNextPageParam: (lastPage) => (lastPage.status === 200 ? lastPage.body.nextCursor : null),
        })
    );

    assignableBothWays<SearchUsersResponse[] | undefined>(query.data?.pages, query.data?.pages);
});
