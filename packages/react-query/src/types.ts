import type {
    CancelOptions,
    FetchInfiniteQueryOptions,
    FetchQueryOptions,
    InfiniteData,
    InvalidateOptions,
    QueryClient,
    QueryKey,
    QueryState,
    RefetchOptions,
    ResetOptions,
    SetDataOptions,
    UseInfiniteQueryOptions,
    UseInfiniteQueryResult,
    UseMutationOptions,
    UseMutationResult,
    UseQueryOptions,
    UseQueryResult,
    UseSuspenseInfiniteQueryOptions,
    UseSuspenseInfiniteQueryResult,
    UseSuspenseQueryOptions,
    UseSuspenseQueryResult,
} from '@tanstack/react-query';
import type { ClientArgs, ClientResponse } from '@ts-kizuna/fetch';
import type { Contract, RouteDefinition } from '@ts-kizuna/core';
import type { KizunaHttpError } from './error.js';

type IsSuccessStatus<S extends number> = `${S}` extends `2${string}` ? true : false;

type SuccessMember<U> = U extends { status: infer S extends number } ? (IsSuccessStatus<S> extends true ? U : never) : never;
type ErrorMember<U> = U extends { status: infer S extends number } ? (IsSuccessStatus<S> extends true ? never : U) : never;

export type DataOf<R extends RouteDefinition> = SuccessMember<ClientResponse<R>>;

type ErrorResponseOf<R extends RouteDefinition> = ErrorMember<ClientResponse<R>>;

type WrapError<U> = U extends { status: infer S extends number; body: infer B; headers: infer H }
    ? KizunaHttpError<B> & { status: S; body: B; headers: H }
    : never;

export type ErrorOf<R extends RouteDefinition> = [ErrorResponseOf<R>] extends [never] ? KizunaHttpError : WrapError<ErrorResponseOf<R>>;

/**
 * Prepend the route's typed arguments to a parameter list, making them optional
 * when every field is optional. Only safe when every element in `Rest` is optional.
 */
type WithArgs<R extends RouteDefinition, Rest extends unknown[]> =
    {} extends ClientArgs<R> ? [args?: ClientArgs<R>, ...rest: Rest] : [args: ClientArgs<R>, ...rest: Rest];

type QueryOptionsArg<R extends RouteDefinition, TData> = Omit<
    UseQueryOptions<DataOf<R>, ErrorOf<R>, TData, QueryKey>,
    'queryKey' | 'queryFn'
>;

type SuspenseQueryOptionsArg<R extends RouteDefinition, TData> = Omit<
    UseSuspenseQueryOptions<DataOf<R>, ErrorOf<R>, TData, QueryKey>,
    'queryKey' | 'queryFn'
>;

type InfiniteOptionsArg<R extends RouteDefinition, TPageParam> = Omit<
    UseInfiniteQueryOptions<DataOf<R>, ErrorOf<R>, InfiniteData<DataOf<R>>, QueryKey, TPageParam>,
    'queryKey' | 'queryFn'
>;

type SuspenseInfiniteOptionsArg<R extends RouteDefinition, TPageParam> = Omit<
    UseSuspenseInfiniteQueryOptions<DataOf<R>, ErrorOf<R>, InfiniteData<DataOf<R>>, QueryKey, TPageParam>,
    'queryKey' | 'queryFn'
>;

type FetchInfiniteArg<R extends RouteDefinition, TPageParam> = Omit<
    FetchInfiniteQueryOptions<DataOf<R>, ErrorOf<R>, InfiniteData<DataOf<R>>, QueryKey, TPageParam>,
    'queryKey' | 'queryFn'
>;

type FetchArg<R extends RouteDefinition> = Omit<FetchQueryOptions<DataOf<R>, ErrorOf<R>, DataOf<R>, QueryKey>, 'queryKey' | 'queryFn'>;

type ArgsFromPageParam<R extends RouteDefinition, TPageParam> = (pageParam: TPageParam) => ClientArgs<R>;

type SetDataUpdater<R extends RouteDefinition> = DataOf<R> | ((previous: DataOf<R> | undefined) => DataOf<R> | undefined);

export type ResolvedQueryOptions<R extends RouteDefinition, TData> = UseQueryOptions<DataOf<R>, ErrorOf<R>, TData, QueryKey>;
export type ResolvedInfiniteQueryOptions<R extends RouteDefinition, TPageParam> = UseInfiniteQueryOptions<
    DataOf<R>,
    ErrorOf<R>,
    InfiniteData<DataOf<R>>,
    QueryKey,
    TPageParam
>;
export type ResolvedMutationOptions<R extends RouteDefinition, TContext> = UseMutationOptions<
    DataOf<R>,
    ErrorOf<R>,
    ClientArgs<R>,
    TContext
>;

/**
 * The full React Query surface for a `GET`/`HEAD`/`OPTIONS` route: hooks, the
 * option factories, the query key, and the `QueryClient` methods bound to it.
 */
export interface QueryNode<R extends RouteDefinition> {
    queryKey: (...args: WithArgs<R, []>) => QueryKey;

    queryOptions: <TData = DataOf<R>>(...args: WithArgs<R, [options?: QueryOptionsArg<R, TData>]>) => ResolvedQueryOptions<R, TData>;
    infiniteQueryOptions: <TPageParam = unknown>(
        args: ClientArgs<R>,
        argsFromPageParam: ArgsFromPageParam<R, TPageParam>,
        options: InfiniteOptionsArg<R, TPageParam>
    ) => ResolvedInfiniteQueryOptions<R, TPageParam>;

    useQuery: <TData = DataOf<R>>(...args: WithArgs<R, [options?: QueryOptionsArg<R, TData>]>) => UseQueryResult<TData, ErrorOf<R>>;
    useSuspenseQuery: <TData = DataOf<R>>(
        ...args: WithArgs<R, [options?: SuspenseQueryOptionsArg<R, TData>]>
    ) => UseSuspenseQueryResult<TData, ErrorOf<R>>;
    usePrefetchQuery: (...args: WithArgs<R, [options?: QueryOptionsArg<R, DataOf<R>>]>) => void;

    useInfiniteQuery: <TPageParam = unknown>(
        args: ClientArgs<R>,
        argsFromPageParam: ArgsFromPageParam<R, TPageParam>,
        options: InfiniteOptionsArg<R, TPageParam>
    ) => UseInfiniteQueryResult<InfiniteData<DataOf<R>>, ErrorOf<R>>;
    useSuspenseInfiniteQuery: <TPageParam = unknown>(
        args: ClientArgs<R>,
        argsFromPageParam: ArgsFromPageParam<R, TPageParam>,
        options: SuspenseInfiniteOptionsArg<R, TPageParam>
    ) => UseSuspenseInfiniteQueryResult<InfiniteData<DataOf<R>>, ErrorOf<R>>;
    usePrefetchInfiniteQuery: <TPageParam = unknown>(
        args: ClientArgs<R>,
        argsFromPageParam: ArgsFromPageParam<R, TPageParam>,
        options: FetchInfiniteArg<R, TPageParam>
    ) => void;

    fetch: (queryClient: QueryClient, ...args: WithArgs<R, [options?: FetchArg<R>]>) => Promise<DataOf<R>>;
    prefetch: (queryClient: QueryClient, ...args: WithArgs<R, [options?: FetchArg<R>]>) => Promise<void>;
    ensureData: (queryClient: QueryClient, ...args: WithArgs<R, [options?: FetchArg<R>]>) => Promise<DataOf<R>>;
    fetchInfinite: <TPageParam = unknown>(
        queryClient: QueryClient,
        args: ClientArgs<R>,
        argsFromPageParam: ArgsFromPageParam<R, TPageParam>,
        options: FetchInfiniteArg<R, TPageParam>
    ) => Promise<InfiniteData<DataOf<R>>>;
    prefetchInfinite: <TPageParam = unknown>(
        queryClient: QueryClient,
        args: ClientArgs<R>,
        argsFromPageParam: ArgsFromPageParam<R, TPageParam>,
        options: FetchInfiniteArg<R, TPageParam>
    ) => Promise<void>;

    getData: (queryClient: QueryClient, ...args: WithArgs<R, []>) => DataOf<R> | undefined;
    setData: (queryClient: QueryClient, args: ClientArgs<R>, updater: SetDataUpdater<R>, options?: SetDataOptions) => DataOf<R> | undefined;
    getState: (queryClient: QueryClient, ...args: WithArgs<R, []>) => QueryState<DataOf<R>, ErrorOf<R>> | undefined;

    invalidate: (queryClient: QueryClient, args?: ClientArgs<R>, options?: InvalidateOptions) => Promise<void>;
    refetch: (queryClient: QueryClient, args?: ClientArgs<R>, options?: RefetchOptions) => Promise<void>;
    cancel: (queryClient: QueryClient, args?: ClientArgs<R>, options?: CancelOptions) => Promise<void>;
    remove: (queryClient: QueryClient, args?: ClientArgs<R>) => void;
    reset: (queryClient: QueryClient, args?: ClientArgs<R>, options?: ResetOptions) => Promise<void>;
}

/**
 * The React Query surface for a mutating route.
 */
export interface MutationNode<R extends RouteDefinition> {
    mutationKey: () => QueryKey;
    mutationOptions: <TContext = unknown>(
        options?: Omit<ResolvedMutationOptions<R, TContext>, 'mutationFn'>
    ) => ResolvedMutationOptions<R, TContext>;
    useMutation: <TContext = unknown>(
        options?: Omit<ResolvedMutationOptions<R, TContext>, 'mutationFn'>
    ) => UseMutationResult<DataOf<R>, ErrorOf<R>, ClientArgs<R>, TContext>;
}

type IsQueryMethod<M extends string> = M extends 'GET' | 'HEAD' | 'OPTIONS' ? true : false;

export type ReactQueryClient<T extends Contract> = {
    [K in keyof T as K extends symbol ? never : K]: T[K] extends RouteDefinition
        ? IsQueryMethod<T[K]['method']> extends true
            ? QueryNode<T[K]>
            : MutationNode<T[K]>
        : T[K] extends Contract
          ? ReactQueryClient<T[K]>
          : never;
};

/**
 * The `QueryClient` methods this client binds per route. Hooks read the client
 * from context; the imperative helpers above take it as their first argument.
 */
export type { QueryClient };
