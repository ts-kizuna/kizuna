import { createClient } from '@ts-kizuna/fetch';
import { contract } from '@ts-kizuna-demo/shared';

export const apiClient = createClient(contract, {
    baseUrl: process.env.API_BASE_URL ?? 'http://localhost:3030/api',
    requestContext: {
        'x-posthog-session-id': process.env.POSTHOG_SESSION_ID,
    },
});
