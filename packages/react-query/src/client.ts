import {
    useInfiniteQuery as tanstackUseInfiniteQuery,
    useMutation as tanstackUseMutation,
    usePrefetchInfiniteQuery as tanstackUsePrefetchInfiniteQuery,
    usePrefetchQuery as tanstackUsePrefetchQuery,
    useQuery as tanstackUseQuery,
    useSuspenseInfiniteQuery as tanstackUseSuspenseInfiniteQuery,
    useSuspenseQuery as tanstackUseSuspenseQuery,
} from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type { ClientConfig } from '@ts-kizuna/fetch';
import { createClient as createFetchClient } from '@ts-kizuna/fetch';
import type { Contract } from '@ts-kizuna/core';
import { isRouteDefinition } from '@ts-kizuna/core';
import { KizunaHttpError } from './error.js';
import type { ReactQueryClient } from './types.js';

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

const callRoute = async (routeFn: RouteFn, args: RuntimeArgs | undefined, signal?: AbortSignal): Promise<RuntimeResult> => {
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
        throw new KizunaHttpError(result);
    }
    return result;
};

const ARG_KEYS = ['params', 'query', 'body', 'headers', 'fetchOptions'];

// The first positional argument of the query hooks can be the route args or the
// React Query options. Args always carry one of the known keys; options never do.
const looksLikeArgs = (value: unknown): boolean =>
    typeof value === 'object' && value !== null && ARG_KEYS.some((key) => key in (value as Record<string, unknown>));

const splitArgs = (first: unknown, second: unknown): { args: RuntimeArgs | undefined; options: object | undefined } => {
    const hasArgs = second !== undefined || looksLikeArgs(first);
    return {
        args: (hasArgs ? first : undefined) as RuntimeArgs | undefined,
        options: (hasArgs ? second : first) as object | undefined,
    };
};

type AnyFn = (...args: never[]) => unknown;

const buildQueryNode = (routeFn: RouteFn, keyPath: readonly string[]): Record<string, AnyFn> => {
    const fullKey = (args?: RuntimeArgs) => [
        ...keyPath,
        {
            params: args?.params,
            query: args?.query,
        },
    ];
    const matchKey = (args: RuntimeArgs | undefined) => (args !== undefined ? fullKey(args) : [...keyPath]);

    const queryFnFor =
        (args?: RuntimeArgs) =>
        ({ signal }: { signal: AbortSignal }) =>
            callRoute(routeFn, args, signal);
    const infiniteQueryFnFor =
        (argsFromPageParam: (pageParam: unknown) => RuntimeArgs) =>
        ({ pageParam, signal }: { pageParam: unknown; signal: AbortSignal }) =>
            callRoute(routeFn, argsFromPageParam(pageParam), signal);

    const buildOptions = (args: RuntimeArgs | undefined, options: object | undefined) => ({
        ...(options ?? {}),
        queryKey: fullKey(args),
        queryFn: queryFnFor(args),
    });
    const buildInfiniteOptions = (args: RuntimeArgs, argsFromPageParam: (pageParam: unknown) => RuntimeArgs, options: object) => ({
        ...options,
        queryKey: fullKey(args),
        queryFn: infiniteQueryFnFor(argsFromPageParam),
    });

    return {
        queryKey: (args?: RuntimeArgs) => fullKey(args) as never,

        queryOptions: (first?: unknown, second?: unknown) => {
            const { args, options } = splitArgs(first, second);
            return buildOptions(args, options) as never;
        },
        infiniteQueryOptions: (args: RuntimeArgs, argsFromPageParam: (pageParam: unknown) => RuntimeArgs, options: object) =>
            buildInfiniteOptions(args, argsFromPageParam, options) as never,

        useQuery: (first?: unknown, second?: unknown) => {
            const { args, options } = splitArgs(first, second);
            return tanstackUseQuery(buildOptions(args, options) as never) as never;
        },
        useSuspenseQuery: (first?: unknown, second?: unknown) => {
            const { args, options } = splitArgs(first, second);
            return tanstackUseSuspenseQuery(buildOptions(args, options) as never) as never;
        },
        usePrefetchQuery: (first?: unknown, second?: unknown) => {
            const { args, options } = splitArgs(first, second);
            return tanstackUsePrefetchQuery(buildOptions(args, options) as never) as never;
        },

        useInfiniteQuery: (args: RuntimeArgs, argsFromPageParam: (pageParam: unknown) => RuntimeArgs, options: object) =>
            tanstackUseInfiniteQuery(buildInfiniteOptions(args, argsFromPageParam, options) as never) as never,
        useSuspenseInfiniteQuery: (args: RuntimeArgs, argsFromPageParam: (pageParam: unknown) => RuntimeArgs, options: object) =>
            tanstackUseSuspenseInfiniteQuery(buildInfiniteOptions(args, argsFromPageParam, options) as never) as never,
        usePrefetchInfiniteQuery: (args: RuntimeArgs, argsFromPageParam: (pageParam: unknown) => RuntimeArgs, options: object) =>
            tanstackUsePrefetchInfiniteQuery(buildInfiniteOptions(args, argsFromPageParam, options) as never) as never,

        fetch: (queryClient: QueryClient, first?: unknown, second?: unknown) => {
            const { args, options } = splitArgs(first, second);
            return queryClient.fetchQuery(buildOptions(args, options) as never) as never;
        },
        prefetch: (queryClient: QueryClient, first?: unknown, second?: unknown) => {
            const { args, options } = splitArgs(first, second);
            return queryClient.prefetchQuery(buildOptions(args, options) as never) as never;
        },
        ensureData: (queryClient: QueryClient, first?: unknown, second?: unknown) => {
            const { args, options } = splitArgs(first, second);
            return queryClient.ensureQueryData(buildOptions(args, options) as never) as never;
        },
        fetchInfinite: (
            queryClient: QueryClient,
            args: RuntimeArgs,
            argsFromPageParam: (pageParam: unknown) => RuntimeArgs,
            options: object
        ) => queryClient.fetchInfiniteQuery(buildInfiniteOptions(args, argsFromPageParam, options) as never) as never,
        prefetchInfinite: (
            queryClient: QueryClient,
            args: RuntimeArgs,
            argsFromPageParam: (pageParam: unknown) => RuntimeArgs,
            options: object
        ) => queryClient.prefetchInfiniteQuery(buildInfiniteOptions(args, argsFromPageParam, options) as never) as never,

        getData: (queryClient: QueryClient, args?: RuntimeArgs) => queryClient.getQueryData(fullKey(args)) as never,
        setData: (queryClient: QueryClient, args: RuntimeArgs, updater: unknown, options?: unknown) =>
            queryClient.setQueryData(fullKey(args), updater as never, options as never) as never,
        getState: (queryClient: QueryClient, args?: RuntimeArgs) => queryClient.getQueryState(fullKey(args)) as never,

        invalidate: (queryClient: QueryClient, first?: unknown, second?: unknown) => {
            const { args, options } = splitArgs(first, second);
            return queryClient.invalidateQueries({ queryKey: matchKey(args) }, options as never) as never;
        },
        refetch: (queryClient: QueryClient, first?: unknown, second?: unknown) => {
            const { args, options } = splitArgs(first, second);
            return queryClient.refetchQueries({ queryKey: matchKey(args) }, options as never) as never;
        },
        cancel: (queryClient: QueryClient, first?: unknown, second?: unknown) => {
            const { args, options } = splitArgs(first, second);
            return queryClient.cancelQueries({ queryKey: matchKey(args) }, options as never) as never;
        },
        remove: (queryClient: QueryClient, args?: RuntimeArgs) => queryClient.removeQueries({ queryKey: matchKey(args) }) as never,
        reset: (queryClient: QueryClient, first?: unknown, second?: unknown) => {
            const { args, options } = splitArgs(first, second);
            return queryClient.resetQueries({ queryKey: matchKey(args) }, options as never) as never;
        },
    };
};

const buildMutationNode = (routeFn: RouteFn, keyPath: readonly string[]): Record<string, AnyFn> => {
    const mutationKey = () => [...keyPath];
    const buildOptions = (options: object | undefined) => ({
        ...(options ?? {}),
        mutationKey: mutationKey(),
        mutationFn: (variables: RuntimeArgs) => callRoute(routeFn, variables),
    });
    return {
        mutationKey: () => mutationKey() as never,
        mutationOptions: (options?: object) => buildOptions(options) as never,
        useMutation: (options?: object) => tanstackUseMutation(buildOptions(options) as never) as never,
    };
};

const isQueryMethod = (method: string): boolean => method === 'GET' || method === 'HEAD' || method === 'OPTIONS';

const buildTree = (contract: Contract, fetchClient: Record<string, unknown>, keyPath: readonly string[]): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(contract)) {
        const node = contract[key];
        const fetchNode = fetchClient[key];
        if (isRouteDefinition(node)) {
            const routeFn = fetchNode as RouteFn;
            result[key] = isQueryMethod(node.method)
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
