import { KizunaClient } from '@ts-kizuna/fetch';
import { contract } from '@ts-kizuna-demo/shared';

export const apiClient = new KizunaClient(contract, {
    baseUrl: process.env.BASE_URL ?? 'http://localhost:8001',
    requestContext: {
        'x-posthog-session-id': process.env.POSTHOG_SESSION_ID,
    },
});
