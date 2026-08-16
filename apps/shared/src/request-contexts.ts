import { z } from 'zod';
import { Kizuna } from '@ts-kizuna/contract';

/**
 * PostHog ids clients send once, on the client initializer; every handler
 * receives them resolved.
 */
export const analytics = Kizuna.requestContext({
    headers: z.object({
        'x-posthog-session-id': z.string().optional(),
        'x-posthog-distinct-id': z.string().optional(),
    }),
    context: z.object({
        sessionId: z.string().nullable(),
        distinctId: z.string().nullable(),
    }),
});
