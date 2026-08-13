import { server } from './server';

export const captureAnalytics = server.requestContext('analytics', ({ request }) => ({
    sessionId: request.headers.get('x-posthog-session-id'),
    distinctId: request.headers.get('x-posthog-distinct-id'),
}));
