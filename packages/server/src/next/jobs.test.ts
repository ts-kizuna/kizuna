import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { Kizuna } from '@ts-kizuna/shared';
import { KizunaServer } from '@ts-kizuna/contract';

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
        sendDigests: () => ({
            status: 200,
            body: {
                sent: 8,
            },
        }),
        reconcile: ({ input }) => ({
            status: 200,
            body: {
                reconciled: input.since.length,
            },
        }),
        cleanup: () => {},
    }),
});

const { GET, POST } = api.mount({
    basePath: '/api',
});

const secret = {
    authorization: 'Bearer cron-secret',
};

describe('the dispatch endpoint', () => {
    it('runs the jobs due this minute, under the base path', async () => {
        const response = await POST(
            new NextRequest('http://localhost:3000/api/jobs/dispatch', {
                method: 'POST',
                headers: secret,
            })
        );
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
        const response = await POST(
            new NextRequest('http://localhost:3000/api/jobs/dispatch', {
                method: 'POST',
            })
        );
        expect(response.status).toBe(401);
        expect(response.headers.get('content-type')).toContain('application/problem+json');
    });

    it('gives a job no endpoint of its own', async () => {
        const response = await POST(
            new NextRequest('http://localhost:3000/api/jobs/send-digests', {
                method: 'POST',
                headers: secret,
            })
        );
        expect(response.status).toBe(404);
    });

    it('leaves the API routes working alongside it', async () => {
        const response = await GET(new NextRequest('http://localhost:3000/api/users'));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(['ada']);
    });

    it('404s a path that is neither a route nor the dispatch endpoint', async () => {
        const response = await GET(new NextRequest('http://localhost:3000/api/nope'));
        expect(response.status).toBe(404);
    });
});
