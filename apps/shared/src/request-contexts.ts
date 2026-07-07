import { z } from 'zod';
import { createRequestContext } from '@ts-kizuna/core';

/**
 * PostHog ids clients send once, on the client initializer; every handler
 * receives them resolved.
 */
export const analytics = createRequestContext({
    headers: z.object({
        'x-posthog-session-id': z.string().optional(),
        'x-posthog-distinct-id': z.string().optional(),
    }),
    context: z.object({
        sessionId: z.string().nullable(),
        distinctId: z.string().nullable(),
    }),
});
