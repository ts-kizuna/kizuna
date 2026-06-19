import { createContext, createElement, useContext, useMemo } from 'react';
import type { PropsWithChildren, ReactNode } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { Contract } from '@ts-kizuna/core';
import type { Client } from '@ts-kizuna/fetch';
import { createKizunaProxy } from './proxy.js';
import type { KizunaProxy, PathProcedures } from './types.js';

interface ContextValue<T extends Contract> {
    proxy: KizunaProxy<T> & PathProcedures;
    client: Client<T>;
}

export type KizunaProviderProps<T extends Contract> = PropsWithChildren<{
    client: Client<T>;
    queryClient: QueryClient;
}>;

export interface KizunaContext<T extends Contract> {
    /**
     * Provides the proxy and client to the tree below. Render it inside your
     * `QueryClientProvider`.
     */
    KizunaProvider: (props: KizunaProviderProps<T>) => ReactNode;
    /**
     * The query/mutation proxy. Throws if used outside the provider.
     */
    useKizuna: () => KizunaProxy<T> & PathProcedures;
    /**
     * The underlying fetch client, for imperative calls. Throws if used outside the provider.
     */
    useKizunaClient: () => Client<T>;
}

/**
 * A React-context TanStack Query integration. Because the proxy is read from
 * context, each request can use its own `QueryClient` — what you want for SSR
 * and frameworks like Next.js. Render `KizunaProvider` inside your
 * `QueryClientProvider`. For client-only apps, {@link createKizunaProxy} is simpler.
 */
export const createKizunaContext = <T extends Contract>(): KizunaContext<T> => {
    const Context = createContext<ContextValue<T> | null>(null);

    const KizunaProvider = (props: KizunaProviderProps<T>): ReactNode => {
        const value = useMemo<ContextValue<T>>(
            () => ({
                client: props.client,
                proxy: createKizunaProxy<T>({
                    client: props.client,
                    queryClient: props.queryClient,
                }),
            }),
            [props.client, props.queryClient]
        );
        return createElement(Context.Provider, { value }, props.children);
    };

    const useKizuna = (): KizunaProxy<T> & PathProcedures => {
        const value = useContext(Context);
        if (value === null) {
            throw new Error('useKizuna must be used within a KizunaProvider.');
        }
        return value.proxy;
    };

    const useKizunaClient = (): Client<T> => {
        const value = useContext(Context);
        if (value === null) {
            throw new Error('useKizunaClient must be used within a KizunaProvider.');
        }
        return value.client;
    };

    return {
        KizunaProvider,
        useKizuna,
        useKizunaClient,
    };
};
