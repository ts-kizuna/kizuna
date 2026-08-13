import { server } from './server';

export const captureAnalytics = server.requestContext('analytics', ({ headers }) => ({
    sessionId: headers['x-posthog-session-id'] ?? null,
    distinctId: headers['x-posthog-distinct-id'] ?? null,
}));
