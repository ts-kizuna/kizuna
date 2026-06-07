import {
    useMutation as useReactMutation,
    useQuery as useReactQuery,
    useSuspenseQuery as useReactSuspenseQuery,
} from '@tanstack/react-query';
import type {
    DefaultError,
    QueryFunctionContext,
    QueryKey,
    UseMutationOptions,
    UseMutationResult,
    UseQueryOptions,
    UseQueryResult,
    UseSuspenseQueryOptions,
    UseSuspenseQueryResult,
} from '@tanstack/react-query';
import type { ClientArgs, ClientConfig, ClientResponse } from '@ts-kizuna/fetch';
import { createClient as createFetchClient } from '@ts-kizuna/fetch';
import type { Contract, RouteDefinition } from '@ts-kizuna/core';
import { isRouteDefinition } from '@ts-kizuna/core';

type SuccessStatus = 200 | 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 226;

type DataOf<R extends RouteDefinition> = Extract<ClientResponse<R>, { status: SuccessStatus }>;
type ErrorResponseOf<R extends RouteDefinition> = Exclude<ClientResponse<R>, { status: SuccessStatus }>;
type ErrorOf<R extends RouteDefinition> = [ErrorResponseOf<R>] extends [never] ? DefaultError : ErrorResponseOf<R>;

type WithArgs<R extends RouteDefinition, Rest extends unknown[]> =
    {} extends ClientArgs<R> ? [args?: ClientArgs<R>, ...rest: Rest] : [args: ClientArgs<R>, ...rest: Rest];

type QueryHookOptions<R extends RouteDefinition, TData> = Omit<
    UseQueryOptions<DataOf<R>, ErrorOf<R>, TData, QueryKey>,
    'queryKey' | 'queryFn'
>;

type SuspenseQueryHookOptions<R extends RouteDefinition, TData> = Omit<
    UseSuspenseQueryOptions<DataOf<R>, ErrorOf<R>, TData, QueryKey>,
    'queryKey' | 'queryFn'
>;

type RouteQueryOptions<R extends RouteDefinition, TData> = UseQueryOptions<DataOf<R>, ErrorOf<R>, TData, QueryKey>;

type MutationHookOptions<R extends RouteDefinition, TContext> = Omit<
    UseMutationOptions<DataOf<R>, ErrorOf<R>, ClientArgs<R>, TContext>,
    'mutationFn'
>;

type RouteMutationOptions<R extends RouteDefinition, TContext> = UseMutationOptions<DataOf<R>, ErrorOf<R>, ClientArgs<R>, TContext>;

export interface QueryNode<R extends RouteDefinition> {
    queryKey: (...args: WithArgs<R, []>) => QueryKey;
    queryOptions: <TData = DataOf<R>>(...args: WithArgs<R, [options?: QueryHookOptions<R, TData>]>) => RouteQueryOptions<R, TData>;
    useQuery: <TData = DataOf<R>>(...args: WithArgs<R, [options?: QueryHookOptions<R, TData>]>) => UseQueryResult<TData, ErrorOf<R>>;
    useSuspenseQuery: <TData = DataOf<R>>(
        ...args: WithArgs<R, [options?: SuspenseQueryHookOptions<R, TData>]>
    ) => UseSuspenseQueryResult<TData, ErrorOf<R>>;
}

export interface MutationNode<R extends RouteDefinition> {
    mutationKey: () => QueryKey;
    mutationOptions: <TContext = unknown>(options?: MutationHookOptions<R, TContext>) => RouteMutationOptions<R, TContext>;
    useMutation: <TContext = unknown>(
        options?: MutationHookOptions<R, TContext>
    ) => UseMutationResult<DataOf<R>, ErrorOf<R>, ClientArgs<R>, TContext>;
}

export type ReactQueryClient<T extends Contract> = {
    [K in keyof T]: T[K] extends RouteDefinition
        ? T[K]['method'] extends 'GET' | 'HEAD'
            ? QueryNode<T[K]>
            : MutationNode<T[K]>
        : T[K] extends Contract
          ? ReactQueryClient<T[K]>
          : never;
};

type RuntimeArgs = {
    params?: Record<string, string | number>;
    query?: Record<string, unknown>;
    body?: unknown;
    headers?: Record<string, string>;
    fetchOptions?: RequestInit;
};

type RuntimeResult = {
    status: number;
    body: unknown;
    headers: Record<string, string>;
};

type RouteFn = (args?: RuntimeArgs) => Promise<RuntimeResult>;

const isSuccessStatus = (status: number): boolean => status >= 200 && status < 300;

// Non-2xx responses are thrown so React Query surfaces them as `error` rather than `data`.
const runRoute = async (routeFn: RouteFn, args: RuntimeArgs | undefined, signal?: AbortSignal): Promise<RuntimeResult> => {
    const merged: RuntimeArgs = signal
        ? {
              ...args,
              fetchOptions: {
                  signal,
                  ...(args?.fetchOptions ?? {}),
              },
          }
        : {
              ...args,
          };
    const result = await routeFn(merged);
    if (!isSuccessStatus(result.status)) {
        throw result;
    }
    return result;
};

const buildQueryNode = (routeFn: RouteFn, keyPath: readonly string[]): QueryNode<RouteDefinition> => {
    const queryKey = (args?: RuntimeArgs): QueryKey => [
        ...keyPath,
        {
            params: args?.params,
            query: args?.query,
        },
    ];
    const buildOptions = (args?: RuntimeArgs, options?: object) =>
        ({
            queryKey: queryKey(args),
            queryFn: ({ signal }: QueryFunctionContext) => runRoute(routeFn, args, signal),
            ...options,
        }) as UseQueryOptions & UseSuspenseQueryOptions;
    return {
        queryKey,
        queryOptions: (args?: RuntimeArgs, options?: object) => buildOptions(args, options),
        useQuery: (args?: RuntimeArgs, options?: object) => useReactQuery(buildOptions(args, options)),
        useSuspenseQuery: (args?: RuntimeArgs, options?: object) => useReactSuspenseQuery(buildOptions(args, options)),
    } as unknown as QueryNode<RouteDefinition>;
};

const buildMutationNode = (routeFn: RouteFn, keyPath: readonly string[]): MutationNode<RouteDefinition> => {
    const mutationKey = (): QueryKey => [...keyPath];
    const buildOptions = (options?: object) =>
        ({
            mutationKey: mutationKey(),
            mutationFn: (variables: RuntimeArgs) => runRoute(routeFn, variables),
            ...options,
        }) as UseMutationOptions<RuntimeResult, DefaultError, RuntimeArgs>;
    return {
        mutationKey,
        mutationOptions: (options?: object) => buildOptions(options),
        useMutation: (options?: object) => useReactMutation(buildOptions(options)),
    } as unknown as MutationNode<RouteDefinition>;
};

const buildTree = (contract: Contract, fetchClient: Record<string, unknown>, keyPath: readonly string[]): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(contract)) {
        const node = contract[key];
        const fetchNode = fetchClient[key];
        if (isRouteDefinition(node)) {
            const routeFn = fetchNode as RouteFn;
            result[key] =
                node.method === 'GET' || node.method === 'HEAD'
                    ? buildQueryNode(routeFn, [...keyPath, key])
                    : buildMutationNode(routeFn, [...keyPath, key]);
        } else if (node && typeof node === 'object') {
            result[key] = buildTree(node as Contract, fetchNode as Record<string, unknown>, [...keyPath, key]);
        }
    }
    return result;
};

/**
 * Create a React Query client from a contract.
 *
 * ```ts
 * // lib/api.ts
 * import { createClient } from '@ts-kizuna/react-query';
 * import { contract } from './contract';
 *
 * export const api = createClient(contract, {
 *     baseUrl: 'https://api.example.com',
 * });
 *
 * // in a component
 * const { data, error } = api.getUser.useQuery({
 *     params: {
 *         id: 'usr_abc123',
 *     },
 * });
 * ```
 */
export const createClient = <T extends Contract>(contract: T, config: ClientConfig): ReactQueryClient<T> => {
    const fetchClient = createFetchClient(contract, config) as unknown as Record<string, unknown>;
    return buildTree(contract, fetchClient, []) as ReactQueryClient<T>;
};

export type { ClientConfig, RequestContext } from '@ts-kizuna/fetch';
