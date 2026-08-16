import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Kizuna } from '@ts-kizuna/contract/internal';
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
    createUser: {
        method: 'POST',
        path: '/users',
        body: z.object({
            name: z.string(),
        }),
        responses: {
            201: z.object({
                id: z.string(),
            }),
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
        createUser: false,
    },
});

const server = new KizunaServer(contract);

const requireScheduler = server.guard('scheduler', ({ bearer, deny }) =>
    bearer?.token === 'cron-secret' ? { invokedBy: 'platform' } : deny(401, 'Unauthorized')
);

const sendDigestsRan = vi.fn();
const reconcileRan = vi.fn();

const buildApp = (options?: { failing?: boolean }) => {
    const router = server.router({
        listUsers: () => ({
            status: 200,
            body: ['ada'],
        }),
        createUser: async ({ body, jobs }) => {
            await jobs.reconcile.queue({
                input: {
                    since: body.name,
                },
            });
            return {
                status: 201,
                body: {
                    id: 'user-1',
                },
            };
        },
    });

    const jobHandlers = server.jobs({
        sendDigests: () => {
            sendDigestsRan();
            if (options?.failing) throw new Error('the mailer is down');
            return {
                status: 200,
                body: {
                    sent: 3,
                },
            };
        },
        reconcile: ({ input }) => {
            reconcileRan(input.since.length);
            return {
                status: 200,
                body: {
                    reconciled: input.since.length,
                },
            };
        },
        cleanup: () => {},
    });

    const api = server.api({
        router,
        guards: {
            scheduler: requireScheduler,
        },
        jobs: jobHandlers,
    });

    const app = express();
    app.use(express.json());
    api.mount(app);
    return app;
};

const tick = (app: express.Express) => request(app).post('/jobs/dispatch').set('authorization', 'Bearer cron-secret');

beforeEach(() => {
    sendDigestsRan.mockClear();
    reconcileRan.mockClear();
});

describe('the dispatch endpoint', () => {
    it('runs the jobs due this minute', async () => {
        const response = await tick(buildApp());
        expect(response.status).toBe(200);
        expect(response.body.due).toEqual(['sendDigests']);
        expect(sendDigestsRan).toHaveBeenCalledTimes(1);
    });

    it('reports what it ran', async () => {
        const response = await tick(buildApp());
        expect(response.body.ran).toEqual([
            {
                job: 'sendDigests',
                status: 'ok',
            },
        ]);
    });

    it('leaves a job that is not due alone', async () => {
        const response = await tick(buildApp());
        expect(response.body.due).not.toContain('cleanup');
    });

    it('rejects a tick without the scheduler credential', async () => {
        const response = await request(buildApp()).post('/jobs/dispatch');
        expect(response.status).toBe(401);
        expect(response.headers['content-type']).toContain('application/problem+json');
        expect(response.body).toMatchObject({
            status: 401,
            title: 'Unauthorized',
            detail: 'Unauthorized',
        });
    });

    it('does not run anything when the guard denies', async () => {
        await request(buildApp()).post('/jobs/dispatch');
        expect(sendDigestsRan).not.toHaveBeenCalled();
    });

    it('answers 503 with the failed names, so the scheduler retries', async () => {
        const response = await tick(buildApp({ failing: true }));
        expect(response.status).toBe(503);
        expect(response.body).toMatchObject({
            status: 503,
            failed: ['sendDigests'],
        });
    });
});

describe('the run endpoint', () => {
    const run = (body: { job: string; input?: unknown }) =>
        request(buildApp()).post('/jobs/run').set('authorization', 'Bearer cron-secret').send(body);

    it('runs the job the body names, answering with its result', async () => {
        const response = await run({
            job: 'reconcile',
            input: {
                since: 'yesterday',
            },
        });
        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            reconciled: 9,
        });
        expect(reconcileRan).toHaveBeenCalledWith(9);
    });

    it('reaches a job by its dotted key', async () => {
        const response = await run({
            job: 'sendDigests',
        });
        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            sent: 3,
        });
    });

    it('answers 204 for a job with no result', async () => {
        const response = await run({
            job: 'cleanup',
        });
        expect(response.status).toBe(204);
    });

    it('validates the input against the schema it lands on', async () => {
        const response = await run({
            job: 'reconcile',
            input: {
                since: 42,
            },
        });
        expect(response.status).toBe(422);
        expect(response.body).toMatchObject({
            status: 422,
        });
        expect(reconcileRan).not.toHaveBeenCalled();
    });

    it('answers 404 for a job the contract does not declare', async () => {
        const response = await run({
            job: 'nope',
        });
        expect(response.status).toBe(404);
        expect(response.body).toMatchObject({
            status: 404,
            detail: 'No job named "nope" on this contract.',
        });
    });

    it('rejects a delivery without the scheduler credential', async () => {
        const response = await request(buildApp()).post('/jobs/run').send({ job: 'sendDigests' });
        expect(response.status).toBe(401);
        expect(sendDigestsRan).not.toHaveBeenCalled();
    });
});

describe('a job outside a tick', () => {
    it('has no endpoint of its own', async () => {
        const response = await request(buildApp()).post('/jobs/send-digests').set('authorization', 'Bearer cron-secret');
        expect(response.status).toBe(404);
    });

    it('is reachable from a route handler through the job runner', async () => {
        const response = await request(buildApp()).post('/users').send({ name: 'yesterday' });
        expect(response.status).toBe(201);
        await vi.waitFor(() => expect(reconcileRan).toHaveBeenCalledWith(9));
    });

    it('leaves the API routes working alongside the dispatch endpoint', async () => {
        const response = await request(buildApp()).get('/users');
        expect(response.status).toBe(200);
        expect(response.body).toEqual(['ada']);
    });

    it('never appears under the routes tree', () => {
        const api = server.api({
            router: server.router({
                listUsers: () => ({
                    status: 200,
                    body: [],
                }),
                createUser: () => ({
                    status: 201,
                    body: {
                        id: 'user-1',
                    },
                }),
            }),
            guards: {
                scheduler: requireScheduler,
            },
            jobs: server.jobs({
                sendDigests: () => ({ status: 200, body: { sent: 0 } }),
                reconcile: () => ({ status: 200, body: { reconciled: 0 } }),
                cleanup: () => {},
            }),
        });
        expect(Object.keys(api.routes)).toEqual(['listUsers', 'createUser']);
    });

    it('reports a job with no handler as failed rather than 500ing the tick', async () => {
        const api = server.api({
            router: server.router({
                listUsers: () => ({
                    status: 200,
                    body: [],
                }),
                createUser: () => ({
                    status: 201,
                    body: {
                        id: 'user-1',
                    },
                }),
            }),
            guards: {
                scheduler: requireScheduler,
            },
            jobs: {
                reconcile: () => ({ status: 200 as const, body: { reconciled: 0 } }),
            } as never,
        });
        const app = express();
        app.use(express.json());
        api.mount(app);
        const response = await request(app).post('/jobs/dispatch').set('authorization', 'Bearer cron-secret');
        expect(response.status).toBe(503);
        expect(response.body.failed).toEqual(['sendDigests']);
    });
});

describe('onJobError', () => {
    const buildAppWithout = (onJobError?: (job: string, error: unknown) => void) => {
        const reporting = new KizunaServer(contract, { onJobError });
        const api = reporting.api({
            router: reporting.router({
                listUsers: () => ({
                    status: 200,
                    body: [],
                }),
                createUser: async ({ jobs }) => {
                    await jobs.reconcile.queue({
                        input: {
                            since: '2026-08-05',
                        },
                    });
                    return {
                        status: 201,
                        body: {
                            id: 'user-1',
                        },
                    };
                },
            }),
            guards: {
                scheduler: reporting.guard('scheduler', ({ bearer, deny }) =>
                    bearer?.token === 'cron-secret' ? { invokedBy: 'platform' } : deny(401, 'Unauthorized')
                ),
            },
            jobs: {
                sendDigests: () => ({ status: 200 as const, body: { sent: 0 } }),
                reconcile: () => {
                    throw new Error('the index is offline');
                },
                cleanup: () => {},
            } as never,
        });
        const app = express();
        app.use(express.json());
        api.mount(app);
        return app;
    };

    it('reaches a job that failed after the response was sent', async () => {
        const onJobError = vi.fn();
        const response = await request(buildAppWithout(onJobError)).post('/users').send({ name: 'ada' });
        expect(response.status).toBe(201);
        await vi.waitFor(() => expect(onJobError).toHaveBeenCalled());
        expect(onJobError.mock.calls[0]?.[0]).toBe('reconcile');
        expect((onJobError.mock.calls[0]?.[1] as Error).message).toBe('the index is offline');
    });

    it('logs the failure when none is configured', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        await request(buildAppWithout()).post('/users').send({ name: 'ada' });
        await vi.waitFor(() => expect(error).toHaveBeenCalled());
        expect(error.mock.calls[0]?.[0]).toContain('reconcile');
        error.mockRestore();
    });
});
