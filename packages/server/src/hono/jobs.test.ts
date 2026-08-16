import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Kizuna } from '@ts-kizuna/contract';
import { KizunaServer } from '../next/server.js';

const scheduler = Kizuna.identity.bearer({
    context: z.object({
        invokedBy: z.string(),
    }),
});

const k = new Kizuna({
    identities: {
        scheduler,
    },
});

const routes = k.routes({
    listUsers: {
        method: 'GET',
        path: '/users',
        responses: {
            200: z.array(z.string()),
        },
    },
});

const jobs = k.jobs('scheduler', {
    sendDigests: {
        schedule: '* * * * *',
        result: z.object({
            sent: z.int(),
        }),
    },
    reconcile: {
        input: z.object({
            since: z.string(),
        }),
        result: z.object({
            reconciled: z.int(),
        }),
    },
    cleanup: {
        schedule: '0 3 * * *',
    },
});

const contract = k.contract({
    routes,
    jobs,
    auth: {
        listUsers: false,
    },
});

const server = new KizunaServer(contract);

const requireScheduler = server.guard('scheduler', ({ bearer, deny }) =>
    bearer?.token === 'cron-secret' ? { invokedBy: 'platform' } : deny(401, 'Unauthorized')
);

const buildApp = (options?: { failing?: boolean }) => {
    const api = server.api({
        router: server.router({
            listUsers: () => ({
                status: 200,
                body: ['ada'],
            }),
        }),
        guards: {
            scheduler: requireScheduler,
        },
        jobs: server.jobs({
            sendDigests: () => {
                if (options?.failing) throw new Error('the mailer is down');
                return {
                    status: 200,
                    body: {
                        sent: 8,
                    },
                };
            },
            reconcile: ({ input }) => ({
                status: 200,
                body: {
                    reconciled: input.since.length,
                },
            }),
            cleanup: () => {},
        }),
    });

    const app = new Hono();
    api.mount(app);
    return app;
};

const secret = {
    authorization: 'Bearer cron-secret',
};

const tick = (app: Hono, options?: RequestInit) =>
    app.request('/jobs/dispatch', {
        method: 'POST',
        headers: secret,
        ...options,
    });

describe('the dispatch endpoint', () => {
    it('runs the jobs due this minute', async () => {
        const response = await tick(buildApp());
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            due: ['sendDigests'],
            ran: [
                {
                    job: 'sendDigests',
                    status: 'ok',
                },
            ],
        });
    });

    it('rejects a tick without the scheduler credential', async () => {
        const response = await buildApp().request('/jobs/dispatch', {
            method: 'POST',
        });
        expect(response.status).toBe(401);
        expect(response.headers.get('content-type')).toContain('application/problem+json');
    });

    it('answers 503 with the failed names, so the scheduler retries', async () => {
        const response = await tick(buildApp({ failing: true }));
        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({
            status: 503,
            failed: ['sendDigests'],
        });
    });

    it('gives a job no endpoint of its own', async () => {
        const response = await buildApp().request('/jobs/send-digests', {
            method: 'POST',
            headers: secret,
        });
        expect(response.status).toBe(404);
    });

    it('leaves the API routes working alongside it', async () => {
        const response = await buildApp().request('/users');
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(['ada']);
    });
});
