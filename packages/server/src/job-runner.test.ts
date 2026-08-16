import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Kizuna } from '@ts-kizuna/contract';
import { createJobRunner, JobInputError } from './job-runner.js';
import { createJobTransport, JobDispatchError, type JobMessage } from '@ts-kizuna/contract';
import { ResponseError } from '@ts-kizuna/contract';

const scheduler = Kizuna.identity.bearer({});

const k = new Kizuna({
    identities: {
        scheduler,
    },
});

const jobs = k.jobs('scheduler', {
    indexPost: {
        input: z.object({
            postId: z.string(),
        }),
        result: z.object({
            indexed: z.boolean(),
        }),
        retry: 3,
    },
    cleanup: {
        schedule: '0 3 * * *',
    },
});

const contract = k.contract({
    routes: k.routes({
        listUsers: {
            method: 'GET',
            path: '/users',
            responses: {
                200: z.array(z.string()),
            },
        },
    }),
    jobs,
    auth: {
        listUsers: false,
    },
});

const indexed = () => ({
    status: 200 as const,
    body: {
        indexed: true,
    },
});

const noop = () => ({
    status: 204 as const,
    body: undefined,
});

/**
 * Records what it was handed instead of delivering anything.
 */
const recordingTransport = () => {
    const sent: JobMessage[] = [];
    return {
        sent,
        transport: createJobTransport({
            name: 'recording',
            supports: {
                retry: true,
                dedupe: true,
                runAt: true,
            },
            dispatch: (message) => {
                sent.push(message);
            },
        }),
    };
};

describe('createJobRunner', () => {
    describe('run', () => {
        it('runs a job in process and returns its result', async () => {
            const runner = createJobRunner(contract, {
                indexPost: ({ input }) => ({
                    status: 200,
                    body: {
                        indexed: input.postId === 'post-1',
                    },
                }),
                cleanup: noop,
            });
            await expect(runner.indexPost.run({ postId: 'post-1' })).resolves.toEqual({
                status: 200,
                body: {
                    indexed: true,
                },
            });
        });

        it('takes no input for a job that declares none', async () => {
            const cleanup = vi.fn(noop);
            const runner = createJobRunner(contract, {
                indexPost: indexed,
                cleanup,
            });
            await runner.cleanup.run();
            expect(cleanup).toHaveBeenCalledTimes(1);
        });

        it('fills in the 204 a handler left off', async () => {
            const runner = createJobRunner(contract, {
                indexPost: indexed,
                cleanup: () => {},
            });
            await expect(runner.cleanup.run()).resolves.toEqual({
                status: 204,
                body: undefined,
            });
        });

        it('gives the handler nothing but input, jobs, and throwError', async () => {
            const seen = vi.fn();
            const runner = createJobRunner(contract, {
                indexPost: (args) => {
                    seen(Object.keys(args).sort());
                    return indexed();
                },
                cleanup: noop,
            });
            await runner.indexPost.run({ postId: 'post-1' });
            expect(seen).toHaveBeenCalledWith(['input', 'jobs', 'throwError']);
        });

        it('validates the input, so an in-process call cannot skip a check', async () => {
            const indexPost = vi.fn();
            const runner = createJobRunner(contract, {
                indexPost: indexPost as never,
                cleanup: noop,
            });
            await expect(runner.indexPost.run({ postId: 42 } as never)).rejects.toThrow(JobInputError);
            expect(indexPost).not.toHaveBeenCalled();
        });

        it('reports which job and which field failed', async () => {
            const runner = createJobRunner(contract, {
                indexPost: vi.fn() as never,
                cleanup: noop,
            });
            const error = await runner.indexPost.run({} as never).catch((caught: unknown) => caught);
            expect(error).toBeInstanceOf(JobInputError);
            expect((error as JobInputError).job).toBe('indexPost');
            expect((error as JobInputError).issues[0]?.path).toEqual(['postId']);
        });

        it('throws throwError as a ResponseError, the same one the HTTP path throws', async () => {
            const runner = createJobRunner(contract, {
                indexPost: indexed,
                cleanup: ({ throwError }) =>
                    throwError({
                        status: 503,
                        body: {
                            detail: 'Provider is down',
                        },
                    }),
            });
            const error = await runner.cleanup.run().catch((caught: unknown) => caught);
            expect(error).toBeInstanceOf(ResponseError);
            expect((error as ResponseError).status).toBe(503);
        });

        it('throws when no handler was bound', async () => {
            const runner = createJobRunner(contract, {} as never);
            await expect(runner.cleanup.run()).rejects.toThrow('No handler was bound for job "cleanup"');
        });

        it('gives a job its siblings, so one job can run another', async () => {
            const cleanupRan = vi.fn();
            const runner = createJobRunner(contract, {
                indexPost: async ({ jobs: siblings }) => {
                    await siblings.cleanup.run();
                    return indexed();
                },
                cleanup: () => {
                    cleanupRan();
                    return noop();
                },
            });
            await runner.indexPost.run({ postId: 'post-1' });
            expect(cleanupRan).toHaveBeenCalledTimes(1);
        });
    });

    it('exposes only the declared jobs', () => {
        const runner = createJobRunner(contract, {
            indexPost: indexed,
            cleanup: noop,
        });
        expect(Object.keys(runner).sort()).toEqual(['cleanup', 'indexPost']);
    });

    it('nests, so a large contract can group its jobs', async () => {
        const nested = k.jobs('scheduler', {
            billing: {
                reconcileInvoices: {
                    input: z.object({
                        since: z.string(),
                    }),
                    result: z.object({
                        reconciled: z.int(),
                    }),
                },
            },
            cleanup: {
                schedule: '0 3 * * *',
            },
        });
        const nestedContract = k.contract({
            routes: k.routes({}),
            jobs: nested,
        });
        const runner = createJobRunner(nestedContract, {
            billing: {
                reconcileInvoices: ({ input }) => ({
                    status: 200,
                    body: {
                        reconciled: input.since.length,
                    },
                }),
            },
            cleanup: noop,
        });
        await expect(runner.billing.reconcileInvoices.run({ since: 'yesterday' })).resolves.toEqual({
            status: 200,
            body: {
                reconciled: 9,
            },
        });
    });

    describe('queue without a transport', () => {
        it('returns before the job finishes', async () => {
            const order: string[] = [];
            let release = (): void => {};
            const blocked = new Promise<void>((resolve) => {
                release = resolve;
            });
            const runner = createJobRunner(contract, {
                indexPost: indexed,
                cleanup: async () => {
                    await blocked;
                    order.push('job');
                },
            });
            await runner.cleanup.queue();
            order.push('caller');
            release();
            await vi.waitFor(() => expect(order).toEqual(['caller', 'job']));
        });

        it('routes a failure to onError instead of throwing at the call site', async () => {
            const onError = vi.fn();
            const runner = createJobRunner(
                contract,
                {
                    indexPost: indexed,
                    cleanup: () => {
                        throw new Error('boom');
                    },
                },
                { onError }
            );
            await expect(runner.cleanup.queue()).resolves.toBeUndefined();
            await vi.waitFor(() => expect(onError).toHaveBeenCalled());
            expect(onError.mock.calls[0]?.[0]).toBe('cleanup');
            expect((onError.mock.calls[0]?.[1] as Error).message).toBe('boom');
        });

        it('rejects bad input at the call site rather than in the background', async () => {
            const indexPost = vi.fn();
            const runner = createJobRunner(contract, {
                indexPost: indexPost as never,
                cleanup: noop,
            });
            await expect(runner.indexPost.queue({ input: {} as never })).rejects.toThrow(JobInputError);
            expect(indexPost).not.toHaveBeenCalled();
        });
    });

    describe('queue with a transport', () => {
        it('hands the transport the job key, route, and validated input', async () => {
            const { sent, transport } = recordingTransport();
            const runner = createJobRunner(contract, { indexPost: indexed, cleanup: noop }, { transport });
            await runner.indexPost.queue({
                input: {
                    postId: 'post-1',
                },
            });
            expect(sent).toEqual([
                {
                    job: 'indexPost',
                    input: {
                        postId: 'post-1',
                    },
                    runAt: undefined,
                    dedupeKey: undefined,
                    retry: 3,
                },
            ]);
        });

        it('does not run the handler', async () => {
            const { transport } = recordingTransport();
            const indexPost = vi.fn(indexed);
            const runner = createJobRunner(contract, { indexPost, cleanup: noop }, { transport });
            await runner.indexPost.queue({
                input: {
                    postId: 'post-1',
                },
            });
            expect(indexPost).not.toHaveBeenCalled();
        });

        it('carries runAt and dedupeKey through', async () => {
            const { sent, transport } = recordingTransport();
            const runner = createJobRunner(contract, { indexPost: indexed, cleanup: noop }, { transport });
            const runAt = new Date('2026-08-06T05:00:00Z');
            await runner.indexPost.queue({
                input: {
                    postId: 'post-1',
                },
                runAt,
                dedupeKey: 'index:post-1',
            });
            expect(sent[0]?.runAt).toBe(runAt);
            expect(sent[0]?.dedupeKey).toBe('index:post-1');
        });

        it('validates before the transport sees anything', async () => {
            const { sent, transport } = recordingTransport();
            const runner = createJobRunner(contract, { indexPost: indexed, cleanup: noop }, { transport });
            await expect(runner.indexPost.queue({ input: {} as never })).rejects.toThrow(JobInputError);
            expect(sent).toHaveLength(0);
        });

        it('names the transport and the job when delivery fails', async () => {
            const transport = createJobTransport({
                name: 'flaky',
                dispatch: () => {
                    throw new Error('connection refused');
                },
            });
            const runner = createJobRunner(contract, { indexPost: indexed, cleanup: noop }, { transport });
            const error = await runner.cleanup.queue().catch((caught: unknown) => caught);
            expect(error).toBeInstanceOf(JobDispatchError);
            expect((error as JobDispatchError).transport).toBe('flaky');
            expect((error as JobDispatchError).job).toBe('cleanup');
            expect((error as JobDispatchError).cause).toBeInstanceOf(Error);
        });

        it('carries a nested job as its dotted key', async () => {
            const nested = k.jobs({
                billing: {
                    reconcile: {},
                },
            });
            const { sent, transport } = recordingTransport();
            const runner = createJobRunner(
                nested,
                {
                    billing: {
                        reconcile: noop,
                    },
                },
                { transport }
            );
            await runner.billing.reconcile.queue();
            expect(sent[0]?.job).toBe('billing.reconcile');
        });
    });

    describe('an option the transport drops', () => {
        const plainTransport = () =>
            createJobTransport({
                name: 'plain',
                dispatch: () => {},
            });

        it('warns that runAt is ignored', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const runner = createJobRunner(contract, { indexPost: indexed, cleanup: noop }, { transport: plainTransport() });
            await runner.cleanup.queue({
                runAt: new Date('2026-08-06T05:00:00Z'),
            });
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('`runAt`'));
            expect(warn.mock.calls[0]?.[0]).toContain('"plain"');
            warn.mockRestore();
        });

        it('warns that dedupeKey is ignored', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const runner = createJobRunner(contract, { indexPost: indexed, cleanup: noop }, { transport: plainTransport() });
            await runner.cleanup.queue({
                dedupeKey: 'cleanup@2026-08-06T05:00:00.000Z',
            });
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('`dedupeKey`'));
            warn.mockRestore();
        });

        it('warns once, so queueing in a loop does not bury the log', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const runner = createJobRunner(contract, { indexPost: indexed, cleanup: noop }, { transport: plainTransport() });
            const runAt = new Date('2026-08-06T05:00:00Z');
            await runner.cleanup.queue({ runAt });
            await runner.cleanup.queue({ runAt });
            await runner.cleanup.queue({ runAt });
            expect(warn).toHaveBeenCalledTimes(1);
            warn.mockRestore();
        });

        it('stays quiet when the transport declares the support', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const { transport } = recordingTransport();
            const runner = createJobRunner(contract, { indexPost: indexed, cleanup: noop }, { transport });
            await runner.cleanup.queue({
                runAt: new Date('2026-08-06T05:00:00Z'),
                dedupeKey: 'cleanup:1',
            });
            expect(warn).not.toHaveBeenCalled();
            warn.mockRestore();
        });

        it('queues it anyway, because a dropped hint is not a failure', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const dispatch = vi.fn();
            const transport = createJobTransport({
                name: 'plain',
                dispatch,
            });
            const runner = createJobRunner(contract, { indexPost: indexed, cleanup: noop }, { transport });
            await runner.cleanup.queue({
                dedupeKey: 'cleanup:1',
            });
            expect(dispatch).toHaveBeenCalledOnce();
            warn.mockRestore();
        });
    });
});
