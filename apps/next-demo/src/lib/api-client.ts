import { KizunaClient } from '@ts-kizuna/fetch';
import { contract } from '@ts-kizuna-demo/shared';

const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:3030/api';

export const apiClient = new KizunaClient(contract, {
    baseUrl,
    requestContext: {
        'x-posthog-session-id': process.env.POSTHOG_SESSION_ID,
    },
});

/**
 * Signed in as Ada, who owns the workspace. Real apps read these off the session;
 * the demo hardcodes them so the page has someone to be.
 */
export const memberClient = new KizunaClient(contract, {
    baseUrl,
    baseHeaders: {
        authorization: 'Bearer tok_ada',
        'x-workspace-token': 'wst_owner',
    },
    requestContext: {
        'x-posthog-session-id': process.env.POSTHOG_SESSION_ID,
    },
});
