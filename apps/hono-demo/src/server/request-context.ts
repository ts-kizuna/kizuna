import { server } from './server';

export const captureAnalytics = server.requestContext('analytics', ({ c }) => ({
    sessionId: c.req.header('x-posthog-session-id') ?? null,
    distinctId: c.req.header('x-posthog-distinct-id') ?? null,
}));
