import { createClient } from '@ts-kizuna/fetch';
import { contract } from '@ts-kizuna-demo/shared';

export const apiClient = createClient(contract, {
    baseUrl: process.env.BASE_URL ?? 'http://localhost:8001',
    requestContext: {
        'x-posthog-session-id': process.env.POSTHOG_SESSION_ID,
    },
    auth: {
        user: () => process.env.SESSION_TOKEN ?? null,
        member: () => process.env.WORKSPACE_TOKEN ?? null,
    },
});
