import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Kizuna } from './kizuna.js';
import { createJobTransport, type JobMessage, type JobWorkerContext } from './job-transport.js';
import { JOBS_META } from './adapter.js';
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
