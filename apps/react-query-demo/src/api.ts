import { QueryClient } from '@tanstack/react-query';
import { contract } from '@ts-kizuna-demo/shared';
import { createClient } from '@ts-kizuna/fetch';
import { createKizunaContext } from '@ts-kizuna/react-query';

export const queryClient = new QueryClient();

// `/api` is proxied to the Express demo server by Vite — see vite.config.ts.
export const client = createClient(contract, {
    baseUrl: '/api',
});

export const { KizunaProvider, useKizuna } = createKizunaContext<typeof contract>();
