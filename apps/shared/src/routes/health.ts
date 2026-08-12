import { z } from 'zod';
import { k } from '../k.js';

export const healthRoutes = k.routes('health', {
    check: {
        method: 'GET',
        path: '/health',
        responses: {
            200: z.object({ ok: z.boolean() }),
        },
        summary: 'Health check, exercises nested sub-client routing',
    },
    version: {
        method: 'GET',
        path: '/health/version',
        responses: {
            200: z.object({ version: z.string() }),
        },
        summary: 'Version, exercises second method in a sub-client group',
    },
    history: {
        method: 'GET',
        path: '/health/history',
        responses: {
            200: z.array(z.object({ ok: z.boolean(), checkedAt: z.iso.datetime() })),
        },
        summary: 'Health history, exercises array return type qualification',
    },
});
