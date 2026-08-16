import { skipToken } from '@tanstack/query-core';
import type { RouteDefinition, Routes } from '@ts-kizuna/core';
import { isRouteDefinition } from '@ts-kizuna/core/adapter';
import { UndeclaredResponseError } from './errors.js';
import { buildPathKey, buildQueryKey } from './keys.js';
import type { KizunaTanstackQueryConstructor } from './types.js';

type ClientNode = (args?: unknown) => Promise<unknown>;

interface ClientResult {
    status: number;
    body: unknown;
    headers: Record<string, string>;
}

// A `body` or `query` schema adds 400, matching `HasValidation` in the client.
const declaresStatus = (route: RouteDefinition, status: number): boolean => {
    if (Object.hasOwn(route.responses, String(status))) {
        return true;
    }
    return status === 400 && ('body' in route || 'query' in route);
};

const withSignal = (args: unknown, signal: AbortSignal | undefined): unknown => {
    if (signal === undefined) {
        return args;
    }

    const { fetchOptions, ...rest } = (args ?? {}) as { fetchOptions?: RequestInit };
    return {
        ...rest,
        fetchOptions: {
            ...fetchOptions,
            signal: fetchOptions?.signal ?? signal,
        },
    };
};

const runRoute = async (
    clientFn: ClientNode,
    route: RouteDefinition,
    routeKey: string,
    args: unknown,
    signal: AbortSignal | undefined
): Promise<unknown> => {
    const result = (await clientFn(withSignal(args, signal))) as ClientResult;

    if (!declaresStatus(route, result.status)) {
        throw new UndeclaredResponseError(routeKey, result.status, result.body, result.headers);
    }

    return result;
};

const isQueryMethod = (route: RouteDefinition): boolean => route.method === 'GET' || route.method === 'HEAD';

const buildProcedure = (segments: readonly string[], route: RouteDefinition, clientFn: ClientNode): Record<string, unknown> => {
    const routeKey = segments.join('.');
    const call = (args?: unknown) => clientFn(args);

    if (!isQueryMethod(route)) {
        return {
            mutationOptions: (options?: Record<string, unknown>) => ({
                mutationKey: buildPathKey(segments),
                mutationFn: (variables: unknown) => runRoute(clientFn, route, routeKey, variables, undefined),
                ...options,
            }),
            mutationKey: () => buildPathKey(segments),
            key: () => buildPathKey(segments),
            call,
        };
    }

    return {
        queryOptions: (options: Record<string, unknown>) => {
            const { input, ...rest } = options;
            const skipped = input === skipToken;
            return {
                queryKey: buildQueryKey(segments, skipped ? undefined : input, 'query'),
                queryFn: skipped ? skipToken : ({ signal }: { signal: AbortSignal }) => runRoute(clientFn, route, routeKey, input, signal),
                ...rest,
            };
        },
        infiniteOptions: (options: Record<string, unknown>) => {
            const { input, ...rest } = options;
            const skipped = input === skipToken;
            return {
                queryKey: buildQueryKey(segments, skipped ? undefined : input, 'infinite'),
                queryFn: skipped
                    ? skipToken
                    : ({ pageParam, signal }: { pageParam: unknown; signal: AbortSignal }) =>
                          runRoute(clientFn, route, routeKey, (input as (pageParam: unknown) => unknown)(pageParam), signal),
                ...rest,
            };
        },
        queryKey: (options?: { input?: unknown }) => buildQueryKey(segments, options?.input, 'query'),
        infiniteKey: (options?: { input?: unknown }) => buildQueryKey(segments, options?.input, 'infinite'),
        key: () => buildPathKey(segments),
        call,
    };
};

const buildNode = (segments: readonly string[], routes: Routes, clientNode: Record<string, unknown>): Record<string, unknown> => {
    // Path-level factories go on first so a route sharing their name wins.
    const node: Record<string, unknown> = {
        key: () => buildPathKey(segments),
    };

    for (const routeName of Object.keys(routes)) {
        const value = routes[routeName];
        const childSegments = [...segments, routeName];
        const childClient = clientNode[routeName];

        node[routeName] = isRouteDefinition(value)
            ? buildProcedure(childSegments, value, childClient as ClientNode)
            : buildNode(childSegments, value as Routes, childClient as Record<string, unknown>);
    }

    return node;
};

function buildQueryProxy(contract: { routes: Routes }, client: Record<string, unknown>): unknown {
    return buildNode([], contract.routes, client);
}

/**
 * Builds TanStack Query options from a contract and a client made from it.
 *
 * ```ts
 * import { useQuery } from '@tanstack/react-query';
 * import { KizunaTanstackQuery } from '@ts-kizuna/tanstack-query';
 * import { contract } from './contract.js';
 * import { apiClient } from './api-client.js';
 *
 * const api = new KizunaTanstackQuery(contract, apiClient);
 *
 * useQuery(
 *     api.users.listUsers.queryOptions({
 *         input: {
 *             query: {
 *                 page: 1,
 *             },
 *         },
 *     })
 * );
 * ```
 */
export const KizunaTanstackQuery = buildQueryProxy as unknown as KizunaTanstackQueryConstructor;
