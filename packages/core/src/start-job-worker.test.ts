import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Kizuna } from './kizuna.js';
import { createJobTransport, type JobMessage, type JobWorkerContext } from './job-transport.js';
import { JOBS_META, WEBHOOKS_META } from './adapter.js';
import { createWebhookSender, WEBHOOK_DELIVERY_JOB_KEY } from './webhook-sender.js';
import { verifyDelivery } from './webhook-signature.js';
import { startWebhookReceiver } from './adapter-testing/webhooks.js';
import { startJobWorker } from './start-job-worker.js';

const k = new Kizuna({});

const jobs = k.jobs({
    cleanup: {},
    users: {
        indexUser: {
            input: z.object({
                userId: z.string(),
            }),
        },
    },
});

const silent = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};

/**
 * A pull transport: it stores nothing and simply hands `start`'s context back,
 * so a test can deliver a message the way a queue would.
 */
const pulling = () => {
    let context: JobWorkerContext | undefined;
    const stop = vi.fn();
    return {
        deliver: (message: JobMessage) => context!.run(message),
        subscribed: () => context!.jobs,
        stop,
        transport: createJobTransport({
            name: 'pulling',
            dispatch: () => {},
            start: (started) => {
                context = started;
                return Promise.resolve({ stop });
            },
        }),
    };
};

const apiWith = (transport: unknown, handlers: Record<string, unknown>) => ({
    [JOBS_META]: {
        jobs,
        handlers,
        transport,
    },
});

const handlers = () => ({
    cleanup: vi.fn(),
    users: {
        indexUser: vi.fn(),
    },
});

describe('startJobWorker', () => {
    it('subscribes to every job the contract declares, by dotted key', async () => {
        const queue = pulling();
        await startJobWorker(apiWith(queue.transport, handlers()), { logger: silent });
        expect(queue.subscribed().map(({ job }) => job)).toEqual(['cleanup', 'users.indexUser']);
    });

    it('routes a delivered message to the nested handler it names', async () => {
        const queue = pulling();
        const bound = handlers();
        await startJobWorker(apiWith(queue.transport, bound), { logger: silent });

        await queue.deliver({
            job: 'users.indexUser',
            input: {
                userId: '1',
            },
        });

        expect(bound.users.indexUser).toHaveBeenCalledOnce();
        expect(bound.cleanup).not.toHaveBeenCalled();
        expect(vi.mocked(bound.users.indexUser).mock.calls[0]?.[0]).toMatchObject({
            input: {
                userId: '1',
            },
        });
    });

    it('validates the input again, so a message that outlived a deploy is checked against the schema it lands on', async () => {
        const queue = pulling();
        const bound = handlers();
        await startJobWorker(apiWith(queue.transport, bound), { logger: silent });

        await expect(
            queue.deliver({
                job: 'users.indexUser',
                input: {
                    userIdentifier: 'renamed since this was queued',
                },
            })
        ).rejects.toThrow('failed validation');
        expect(bound.users.indexUser).not.toHaveBeenCalled();
    });

    it('propagates a handler rejection, which is how the transport learns to retry', async () => {
        const queue = pulling();
        const bound = handlers();
        bound.cleanup.mockRejectedValue(new Error('the disk is full'));
        await startJobWorker(apiWith(queue.transport, bound), { logger: silent });

        await expect(
            queue.deliver({
                job: 'cleanup',
                input: undefined,
            })
        ).rejects.toThrow('the disk is full');
    });

    it('returns the transport’s worker, so a caller can stop draining', async () => {
        const queue = pulling();
        const worker = await startJobWorker(apiWith(queue.transport, handlers()), { logger: silent });
        await worker?.stop();
        expect(queue.stop).toHaveBeenCalledOnce();
    });

    it('returns undefined for a push transport, which needs no worker', async () => {
        const push = createJobTransport({
            name: 'push',
            dispatch: () => {},
        });
        expect(await startJobWorker(apiWith(push, handlers()), { logger: silent })).toBeUndefined();
    });

    it('returns undefined when no transport is configured', async () => {
        expect(await startJobWorker({ [JOBS_META]: { jobs, handlers: handlers() } }, { logger: silent })).toBeUndefined();
    });

    it('returns undefined for an api with no jobs', async () => {
        expect(await startJobWorker({}, { logger: silent })).toBeUndefined();
    });

    it('skips a job with no handler rather than subscribing to one that cannot run', async () => {
        const queue = pulling();
        await startJobWorker(apiWith(queue.transport, { cleanup: () => {} }), { logger: silent });
        expect(queue.subscribed().map(({ job }) => job)).toEqual(['cleanup']);
        expect(silent.warn).toHaveBeenCalledWith(expect.stringContaining('users.indexUser'));
    });

    it('honours only and exclude', async () => {
        const included = pulling();
        await startJobWorker(apiWith(included.transport, handlers()), { only: ['cleanup'], logger: silent });
        expect(included.subscribed().map(({ job }) => job)).toEqual(['cleanup']);

        const excluded = pulling();
        await startJobWorker(apiWith(excluded.transport, handlers()), { exclude: ['cleanup'], logger: silent });
        expect(excluded.subscribed().map(({ job }) => job)).toEqual(['users.indexUser']);
    });
});

const webhookEvents = k.webhooks({
    userCreated: {
        body: z.object({
            id: z.string(),
        }),
    },
});

describe('startJobWorker webhook deliveries', () => {
    const subscriber = {
        url: 'https://example.com/hooks',
        secret: 'whsec_test',
    };

    const webhooksMetaWith = (transport: unknown) => ({
        webhooks: webhookEvents,
        subscribers: () => [subscriber],
        transport,
    });

    it('subscribes to the delivery job alongside the declared jobs', async () => {
        const queue = pulling();
        const api = {
            ...apiWith(queue.transport, handlers()),
            [WEBHOOKS_META]: webhooksMetaWith(undefined),
        };
        await startJobWorker(api, { logger: silent });
        expect(queue.subscribed().map(({ job }) => job)).toEqual(['cleanup', 'users.indexUser', WEBHOOK_DELIVERY_JOB_KEY]);
    });

    it('starts for an api with webhooks and no jobs', async () => {
        const queue = pulling();
        await startJobWorker({ [WEBHOOKS_META]: webhooksMetaWith(queue.transport) }, { logger: silent });
        expect(queue.subscribed().map(({ job }) => job)).toEqual([WEBHOOK_DELIVERY_JOB_KEY]);
    });

    it('honours exclude for the delivery job', async () => {
        const queue = pulling();
        await startJobWorker(
            { [WEBHOOKS_META]: webhooksMetaWith(queue.transport) },
            { exclude: [WEBHOOK_DELIVERY_JOB_KEY], logger: silent }
        );
        expect(queue.subscribed()).toEqual([]);
    });

    it('propagates a failed delivery, which is how the transport learns to retry', async () => {
        const queue = pulling();
        await startJobWorker({ [WEBHOOKS_META]: webhooksMetaWith(queue.transport) }, { logger: silent });

        await expect(
            queue.deliver({
                job: WEBHOOK_DELIVERY_JOB_KEY,
                input: {
                    nonsense: true,
                },
            })
        ).rejects.toThrow('not a webhook delivery');
    });

    it('carries a sent event through the transport to the subscriber, signed with the current secret', async () => {
        const receiver = await startWebhookReceiver();
        let context: JobWorkerContext | undefined;
        const inline = createJobTransport({
            name: 'inline',
            dispatch: async (message) => {
                await context!.run(message);
            },
            start: (started) => {
                context = started;
                return Promise.resolve({
                    stop: () => {},
                });
            },
        });
        const webhooksMeta = {
            webhooks: webhookEvents,
            subscribers: () => [
                {
                    url: receiver.url,
                    secret: 'whsec_test',
                },
            ],
            transport: inline,
        };
        await startJobWorker({ [WEBHOOKS_META]: webhooksMeta }, { logger: silent });

        const sender = createWebhookSender(webhookEvents, {
            subscribers: webhooksMeta.subscribers,
            transport: inline,
        });
        await sender.userCreated.send({
            body: {
                id: 'u1',
            },
        });

        const delivery = await receiver.delivered;
        expect(JSON.parse(delivery.body)).toEqual({
            id: 'u1',
        });
        expect(
            await verifyDelivery({
                scheme: 'rfc9421',
                secret: 'whsec_test',
                body: delivery.body,
                url: receiver.url,
                method: 'POST',
                headers: delivery.headers,
            })
        ).toBe(true);
        await receiver.close();
    });
});
