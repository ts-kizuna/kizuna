import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Kizuna } from '@ts-kizuna/contract/internal';
import { KizunaServer } from './server.js';

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

const buildApp = async (options?: { failing?: boolean }) => {
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

    const app = Fastify();
    await api.mount(app);
    await app.ready();
    return app;
};

const secret = {
    authorization: 'Bearer cron-secret',
};

describe('the dispatch endpoint', () => {
    it('runs the jobs due this minute', async () => {
        const response = await (
            await buildApp()
        ).inject({
            method: 'POST',
            url: '/jobs/dispatch',
            headers: secret,
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
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
        const response = await (
            await buildApp()
        ).inject({
            method: 'POST',
            url: '/jobs/dispatch',
        });
        expect(response.statusCode).toBe(401);
        expect(response.headers['content-type']).toContain('application/problem+json');
    });

    it('answers 503 with the failed names, so the scheduler retries', async () => {
        const response = await (
            await buildApp({ failing: true })
        ).inject({
            method: 'POST',
            url: '/jobs/dispatch',
            headers: secret,
        });
        expect(response.statusCode).toBe(503);
        expect(response.json()).toMatchObject({
            status: 503,
            failed: ['sendDigests'],
        });
    });

    it('gives a job no endpoint of its own', async () => {
        const response = await (
            await buildApp()
        ).inject({
            method: 'POST',
            url: '/jobs/send-digests',
            headers: secret,
        });
        expect(response.statusCode).toBe(404);
    });

    it('leaves the API routes working alongside it', async () => {
        const response = await (
            await buildApp()
        ).inject({
            method: 'GET',
            url: '/users',
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual(['ada']);
    });
});
