import type {
    DataTag,
    DefaultError,
    InfiniteData,
    InfiniteQueryObserverOptions,
    MutationObserverOptions,
    QueryFunctionContext,
    QueryObserverOptions,
    SkipToken,
} from '@tanstack/query-core';
import type { RouteDefinition, Routes } from '@ts-kizuna/core';
import type { Client, ClientArgs, ClientResponse } from '@ts-kizuna/fetch';

export type KizunaQueryKeyType = 'query' | 'infinite';

/**
 * `[segments, { input, type }]`, for example
 * `[['users', 'getUser'], { input: { params: { id: '1' } }, type: 'query' }]`.
 */
export type KizunaQueryKey = readonly [readonly string[], { readonly input?: unknown; readonly type: KizunaQueryKeyType }];

/**
 * `[segments]`, the prefix every operation under a route or group matches.
 */
export type KizunaPathKey = readonly [readonly string[]];

type HasOptionalArgs<R extends RouteDefinition> = {} extends ClientArgs<R> ? true : false;

type CallFn<R extends RouteDefinition, Codes extends string> =
    HasOptionalArgs<R> extends true
        ? (args?: ClientArgs<R>) => Promise<ClientResponse<R, Codes>>
        : (args: ClientArgs<R>) => Promise<ClientResponse<R, Codes>>;

// From `query-core`, so no framework's option type is named. `TData` stays
// `unknown` because the framework re-infers the selected type from `U`.
type QueryExtras<TQueryFnData, TError> = Omit<
    QueryObserverOptions<TQueryFnData, TError, unknown, TQueryFnData, KizunaQueryKey>,
    'queryKey' | 'queryFn'
>;

type QueryInput<R extends RouteDefinition> =
    HasOptionalArgs<R> extends true ? { input?: ClientArgs<R> | SkipToken } : { input: ClientArgs<R> | SkipToken };

// `U` passing through is what preserves `initialData` narrowing: a given
// `initialData` stays required, which is all the defined-data overload keys on.
type QueryOptionsOut<U, TQueryFnData, TError> = Omit<NoInfer<U>, 'input'> & {
    queryKey: DataTag<KizunaQueryKey, TQueryFnData, TError>;
    queryFn: U extends { input: SkipToken } ? SkipToken : (context: QueryFunctionContext<KizunaQueryKey>) => Promise<TQueryFnData>;
};

type QueryOptionsFn<R extends RouteDefinition, Codes extends string> = <
    U extends QueryInput<R> & QueryExtras<ClientResponse<R, Codes>, DefaultError>,
>(
    options: U
) => QueryOptionsOut<U, ClientResponse<R, Codes>, DefaultError>;

type InfiniteExtras<TQueryFnData, TError, TPageParam> = Omit<
    InfiniteQueryObserverOptions<TQueryFnData, TError, unknown, KizunaQueryKey, TPageParam>,
    'queryKey' | 'queryFn'
>;

type InfiniteOptionsOut<U, TQueryFnData, TError, TPageParam, Skipped extends boolean> = Omit<NoInfer<U>, 'input'> & {
    queryKey: DataTag<KizunaQueryKey, InfiniteData<TQueryFnData, TPageParam>, TError>;
    queryFn: Skipped extends true ? SkipToken : (context: QueryFunctionContext<KizunaQueryKey, TPageParam>) => Promise<TQueryFnData>;
};

// `input` sits outside `U`, and skipToken gets its own signature, because
// `TPageParam` only infers from a real parameter position.
interface InfiniteOptionsFn<R extends RouteDefinition, Codes extends string> {
    <TPageParam, U extends InfiniteExtras<ClientResponse<R, Codes>, DefaultError, TPageParam>>(
        options: { input: (pageParam: TPageParam) => ClientArgs<R> } & U
    ): InfiniteOptionsOut<U, ClientResponse<R, Codes>, DefaultError, TPageParam, false>;
    <TPageParam, U extends InfiniteExtras<ClientResponse<R, Codes>, DefaultError, TPageParam>>(
        options: { input: SkipToken } & U
    ): InfiniteOptionsOut<U, ClientResponse<R, Codes>, DefaultError, TPageParam, true>;
}

type KeyFn<R extends RouteDefinition> = (options?: { input?: ClientArgs<R> }) => KizunaQueryKey;

/**
 * A route whose method is `GET` or `HEAD`.
 */
export interface QueryProcedure<R extends RouteDefinition, Codes extends string> {
    /**
     * Options for `useQuery`. `data` is the route's declared response union; an
     * undeclared status throws.
     */
    queryOptions: QueryOptionsFn<R, Codes>;
    /**
     * Options for `useInfiniteQuery`. `input` is a function of the page parameter.
     */
    infiniteOptions: InfiniteOptionsFn<R, Codes>;
    /**
     * The query's full key.
     */
    queryKey: KeyFn<R>;
    /**
     * The infinite query's full key.
     */
    infiniteKey: KeyFn<R>;
    /**
     * The partial key matching every operation on this route.
     */
    key: () => KizunaPathKey;
    /**
     * Calls the route, bypassing the cache.
     */
    call: CallFn<R, Codes>;
}

type MutationVariables<R extends RouteDefinition> = HasOptionalArgs<R> extends true ? void : ClientArgs<R>;

type MutationExtras<R extends RouteDefinition, Codes extends string, TError> = Omit<
    MutationObserverOptions<ClientResponse<R, Codes>, TError, MutationVariables<R>>,
    'mutationKey' | 'mutationFn'
>;

type MutationOptionsFn<R extends RouteDefinition, Codes extends string> = <
    U extends MutationExtras<R, Codes, DefaultError> = MutationExtras<R, Codes, DefaultError>,
>(
    options?: U
) => NoInfer<U> & {
    mutationKey: KizunaPathKey;
    mutationFn: (variables: MutationVariables<R>) => Promise<ClientResponse<R, Codes>>;
};

/**
 * A route whose method is anything other than `GET` or `HEAD`.
 */
export interface MutationProcedure<R extends RouteDefinition, Codes extends string> {
    /**
     * Options for `useMutation`. `mutate` takes the route's call arguments, or
     * nothing when every argument is optional.
     */
    mutationOptions: MutationOptionsFn<R, Codes>;
    /**
     * The mutation's full key.
     */
    mutationKey: () => KizunaPathKey;
    /**
     * The partial key matching this route.
     */
    key: () => KizunaPathKey;
    /**
     * Calls the route, outside a mutation.
     */
    call: CallFn<R, Codes>;
}

/**
 * Carried by the root and every group, for invalidating a whole group at once.
 */
export interface PathProcedures {
    key: () => KizunaPathKey;
}

type Procedure<R extends RouteDefinition, Codes extends string> = R['method'] extends 'GET' | 'HEAD'
    ? QueryProcedure<R, Codes>
    : MutationProcedure<R, Codes>;

/**
 * The route tree, each route carrying its query or mutation factories.
 */
export type KizunaQueryProxy<T extends Routes, Codes extends string = never> = {
    [K in keyof T as K extends string ? K : never]: T[K] extends RouteDefinition
        ? Procedure<T[K], Codes>
        : T[K] extends Routes
          ? KizunaQueryProxy<T[K], Codes> & PathProcedures
          : never;
};

export interface KizunaTanstackQueryConstructor {
    /**
     * Only `routes` is read from the contract, so any contract satisfies this.
     */
    new <T extends Routes, Codes extends string = never>(
        contract: { routes: T },
        client: Client<T, Codes>
    ): KizunaQueryProxy<T, Codes> & PathProcedures;
}
