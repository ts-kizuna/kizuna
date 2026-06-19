import { skipToken } from '@tanstack/react-query';
import type { QueryClient, QueryFilters } from '@tanstack/react-query';
import type { Contract } from '@ts-kizuna/core';
import type { Client } from '@ts-kizuna/fetch';
import type { KizunaPathKey, KizunaProxy, KizunaQueryKey, PathProcedures } from './types.js';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const callClient = (clientNode: unknown, args: unknown): Promise<unknown> => {
    if (typeof clientNode !== 'function') {
        throw new Error('ts-kizuna react-query: tried to call an operation that does not exist on the client. Check the proxy path.');
    }
    return clientNode(args);
};

const buildQueryKey = (path: readonly string[], input: unknown): KizunaQueryKey =>
    input === undefined ? [path, { type: 'query' }] : [path, { input, type: 'query' }];

const buildPathKey = (path: readonly string[]): KizunaPathKey => [path];

const createProxy = (path: readonly string[], clientNode: unknown): unknown => {
    return new Proxy(() => undefined, {
        get(_target, property) {
            if (typeof property !== 'string') return undefined;

            switch (property) {
                case 'queryOptions':
                    return (input?: unknown, options?: Record<string, unknown>) => {
                        const disabled = input === skipToken;
                        return {
                            queryKey: disabled ? buildQueryKey(path, undefined) : buildQueryKey(path, input),
                            queryFn: disabled ? skipToken : () => callClient(clientNode, input),
                            ...options,
                        };
                    };
                case 'queryKey':
                    return (input?: unknown) => buildQueryKey(path, input);
                case 'queryFilter':
                    return (input?: unknown, filters?: QueryFilters) => ({
                        queryKey: buildQueryKey(path, input),
                        ...filters,
                    });
                case 'mutationOptions':
                    return (options?: Record<string, unknown>) => ({
                        mutationKey: buildPathKey(path),
                        mutationFn: (variables: unknown) => callClient(clientNode, variables),
                        ...options,
                    });
                case 'mutationKey':
                    return () => buildPathKey(path);
                case 'pathKey':
                    return () => buildPathKey(path);
                case 'pathFilter':
                    return (filters?: QueryFilters) => ({
                        queryKey: buildPathKey(path),
                        ...filters,
                    });
                default: {
                    const nextNode = isRecord(clientNode) ? clientNode[property] : undefined;
                    return createProxy([...path, property], nextNode);
                }
            }
        },
    });
};

export interface CreateKizunaProxyOptions<T extends Contract> {
    /**
     * A fetch client built from the same contract via `createClient` from
     * `@ts-kizuna/fetch`. The proxy calls into it to run requests.
     */
    client: Client<T>;
    /**
     * Optional — the current factories don't need it; accepted for parity with
     * {@link createKizunaContext} and forward compatibility.
     */
    queryClient?: QueryClient;
}

/**
 * A context-free TanStack Query proxy over a contract, for client-only apps
 * (e.g. a Vite SPA). For SSR or per-request caching, use {@link createKizunaContext}.
 */
export const createKizunaProxy = <T extends Contract>(options: CreateKizunaProxyOptions<T>): KizunaProxy<T> & PathProcedures => {
    return createProxy([], options.client) as KizunaProxy<T> & PathProcedures;
};
