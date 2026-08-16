import { KizunaClient } from '@ts-kizuna/fetch';
import { KizunaTanstackQuery } from '@ts-kizuna/tanstack-query';
import { contract } from '@ts-kizuna-demo/shared';

export const apiClient = new KizunaClient(contract, {
    baseUrl: '/api',
    requestContext: {
        'x-posthog-session-id': 'tanstack-query-demo',
    },
});

export const api = new KizunaTanstackQuery(contract, apiClient);
