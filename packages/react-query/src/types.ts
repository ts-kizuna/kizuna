import type { DefaultError, QueryFilters, SkipToken, UseMutationOptions, UseQueryOptions } from '@tanstack/react-query';
import type { Contract, RouteDefinition } from '@ts-kizuna/core';
import type { ClientArgs, ClientResponse } from '@ts-kizuna/fetch';

/**
 * `[pathSegments, { input, type }]` — e.g. `[['users', 'getUser'], { input, type: 'query' }]`.
 */
export type KizunaQueryKey = readonly [readonly string[], { readonly input?: unknown; readonly type: 'query' }];

/**
 * `[pathSegments]` — a prefix key for fuzzy-matching every operation under a router.
 */
export type KizunaPathKey = readonly [readonly string[]];

type HasOptionalArgs<R extends RouteDefinition> = {} extends ClientArgs<R> ? true : false;

type MutationVariables<R extends RouteDefinition> = HasOptionalArgs<R> extends true ? void : ClientArgs<R>;

type ExtraQueryOptions<R extends RouteDefinition, TData> = Omit<
    UseQueryOptions<ClientResponse<R>, DefaultError, TData, KizunaQueryKey>,
    'queryKey' | 'queryFn'
>;

type ResolvedQueryOptions<R extends RouteDefinition, TData> = UseQueryOptions<ClientResponse<R>, DefaultError, TData, KizunaQueryKey> & {
    queryKey: KizunaQueryKey;
};

type QueryOptionsFn<R extends RouteDefinition> =
    HasOptionalArgs<R> extends true
        ? <TData = ClientResponse<R>>(
              input?: ClientArgs<R> | SkipToken,
              options?: ExtraQueryOptions<R, TData>
          ) => ResolvedQueryOptions<R, TData>
        : <TData = ClientResponse<R>>(
              input: ClientArgs<R> | SkipToken,
              options?: ExtraQueryOptions<R, TData>
          ) => ResolvedQueryOptions<R, TData>;

type QueryKeyFn<R extends RouteDefinition> =
    HasOptionalArgs<R> extends true ? (input?: ClientArgs<R>) => KizunaQueryKey : (input: ClientArgs<R>) => KizunaQueryKey;

type QueryFilterFn<R extends RouteDefinition> = (
    input?: ClientArgs<R>,
    filters?: QueryFilters
) => QueryFilters & { queryKey: KizunaQueryKey };

/**
 * Factories on a query operation (a `GET` or `HEAD` route).
 */
export interface QueryProcedure<R extends RouteDefinition> {
    /**
     * `data` is the operation's full `{ status, body, headers }` union — discriminate
     * on `status`. Errors are modeled responses, not thrown.
     */
    queryOptions: QueryOptionsFn<R>;
    /**
     * The type-safe key for this operation, for `QueryClient` methods like
     * `invalidateQueries` and `getQueryData`.
     */
    queryKey: QueryKeyFn<R>;
    /**
     * A type-safe filter for this operation, for `invalidateQueries`, `cancelQueries`, etc.
     */
    queryFilter: QueryFilterFn<R>;
}

/**
 * Factories on a mutation operation (a `POST`, `PUT`, `PATCH`, or `DELETE` route).
 */
export interface MutationProcedure<R extends RouteDefinition> {
    /**
     * `mutate`/`mutateAsync` take the operation's call args; the result is the
     * full `{ status, body, headers }` union.
     */
    mutationOptions: (
        options?: Omit<UseMutationOptions<ClientResponse<R>, DefaultError, MutationVariables<R>>, 'mutationKey' | 'mutationFn'>
    ) => UseMutationOptions<ClientResponse<R>, DefaultError, MutationVariables<R>> & { mutationKey: KizunaPathKey };
    mutationKey: () => KizunaPathKey;
}

type ProcedureProxy<R extends RouteDefinition> = R['method'] extends 'GET' | 'HEAD' ? QueryProcedure<R> : MutationProcedure<R>;

/**
 * Path-level factories on the root and every sub-contract, for invalidating a
 * whole router at once.
 */
export interface PathProcedures {
    pathKey: () => KizunaPathKey;
    pathFilter: (filters?: QueryFilters) => QueryFilters & { queryKey: KizunaPathKey };
}

/**
 * The typed proxy over a contract: each operation carries its query or mutation
 * factories; each router node also carries the path-level factories.
 */
export type KizunaProxy<T extends Contract> = {
    [K in keyof T]: T[K] extends RouteDefinition
        ? ProcedureProxy<T[K]>
        : T[K] extends Contract
          ? KizunaProxy<T[K]> & PathProcedures
          : never;
};
