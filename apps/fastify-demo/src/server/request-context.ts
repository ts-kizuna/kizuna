import { getHeaderValue } from '@ts-kizuna/server';
import { server } from './server';

export const captureAnalytics = server.requestContext('analytics', ({ request }) => ({
    sessionId: getHeaderValue(request.headers['x-posthog-session-id']) ?? null,
    distinctId: getHeaderValue(request.headers['x-posthog-distinct-id']) ?? null,
}));
