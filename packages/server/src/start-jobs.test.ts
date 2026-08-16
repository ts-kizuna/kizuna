import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Kizuna } from '@ts-kizuna/contract';
import { createJobTransport, type JobMessage, type ScheduledJob } from '@ts-kizuna/contract';
import { JOBS_META } from './adapter.js';
import { occurrenceKey, startJobs } from './start-jobs.js';

const k = new Kizuna({});

const jobs = k.jobs({
    cleanup: {
        schedule: '0 3 * * *',
    },
    reportDaily: {
        schedule: {
            cron: '0 6 * * *',
            timezone: 'Europe/Oslo',
        },
        result: z.object({
            sent: z.int(),
        }),
    },
    indexUser: {
        input: z.object({
            userId: z.string(),
        }),
    },
});

const handlers = {
    cleanup: () => {},
    reportDaily: () => ({
        status: 200 as const,
        body: {
            sent: 1,
        },
    }),
    indexUser: () => {},
};

const silent = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};

const recording = () => {
    const sent: JobMessage[] = [];
    return {
        sent,
        transport: createJobTransport({
            name: 'recording',
            supports: {
                dedupe: true,
            },
            dispatch: (message) => {
                sent.push(message);
            },
        }),
    };
};

const apiWith = (transport?: ReturnType<typeof recording>['transport']) => ({
    [JOBS_META]: {
        jobs,
        handlers,
        transport,
    },
});

beforeEach(() => {
    vi.useFakeTimers();
    silent.log.mockClear();
    silent.warn.mockClear();
    silent.error.mockClear();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('startJobs', () => {
    it('queues a job when its schedule fires', async () => {
        vi.setSystemTime(new Date('2026-08-05T02:59:00Z'));
        const { sent, transport } = recording();
        const scheduler = startJobs(apiWith(transport), { only: ['cleanup'], logger: silent });
        await vi.advanceTimersByTimeAsync(61_000);
        scheduler.stop();
        expect(sent).toHaveLength(1);
        expect(sent[0]?.job).toBe('cleanup');
    });

    it('names the occurrence, so a duplicate tick collapses', async () => {
        vi.setSystemTime(new Date('2026-08-05T02:59:00Z'));
        const { sent, transport } = recording();
        const scheduler = startJobs(apiWith(transport), { only: ['cleanup'], logger: silent });
        await vi.advanceTimersByTimeAsync(61_000);
        scheduler.stop();
        expect(sent[0]?.dedupeKey).toBe('cleanup@2026-08-05T03:00:00.000Z');
    });

    it('gives two instances of the same minute the same key', () => {
        const occurrence = new Date('2026-08-05T03:00:00.000Z');
        expect(occurrenceKey('cleanup', occurrence)).toBe(occurrenceKey('cleanup', new Date(occurrence)));
    });

    it('reads the schedule in its declared time zone', async () => {
        // 06:00 in Europe/Oslo is 04:00 UTC in August.
        vi.setSystemTime(new Date('2026-08-05T03:59:00Z'));
        const { sent, transport } = recording();
        const scheduler = startJobs(apiWith(transport), { only: ['reportDaily'], logger: silent });
        await vi.advanceTimersByTimeAsync(61_000);
        scheduler.stop();
        expect(sent[0]?.dedupeKey).toBe('reportDaily@2026-08-05T04:00:00.000Z');
    });

    it('keeps ticking, so a schedule fires more than once', async () => {
        vi.setSystemTime(new Date('2026-08-05T02:59:00Z'));
        const { sent, transport } = recording();
        const scheduler = startJobs(apiWith(transport), { only: ['cleanup'], logger: silent });
        await vi.advanceTimersByTimeAsync(2 * 24 * 60 * 60 * 1000);
        scheduler.stop();
        expect(sent.map((message) => message.dedupeKey)).toEqual(['cleanup@2026-08-05T03:00:00.000Z', 'cleanup@2026-08-06T03:00:00.000Z']);
    });

    it('never ticks a job with no schedule', async () => {
        vi.setSystemTime(new Date('2026-08-05T02:59:00Z'));
        const { sent, transport } = recording();
        const scheduler = startJobs(apiWith(transport), { logger: silent });
        await vi.advanceTimersByTimeAsync(2 * 24 * 60 * 60 * 1000);
        scheduler.stop();
        expect(sent.some((message) => message.job === 'indexUser')).toBe(false);
    });

    it('stops ticking once stopped', async () => {
        vi.setSystemTime(new Date('2026-08-05T02:59:00Z'));
        const { sent, transport } = recording();
        startJobs(apiWith(transport), { only: ['cleanup'], logger: silent }).stop();
        await vi.advanceTimersByTimeAsync(2 * 24 * 60 * 60 * 1000);
        expect(sent).toHaveLength(0);
    });

    it('honours exclude', async () => {
        vi.setSystemTime(new Date('2026-08-05T02:59:00Z'));
        const { sent, transport } = recording();
        const scheduler = startJobs(apiWith(transport), { exclude: ['cleanup'], logger: silent });
        await vi.advanceTimersByTimeAsync(61_000);
        scheduler.stop();
        expect(sent).toHaveLength(0);
    });

    it('runs the job in this process when no transport is configured', async () => {
        vi.setSystemTime(new Date('2026-08-05T02:59:00Z'));
        const cleanup = vi.fn();
        const scheduler = startJobs(
            {
                [JOBS_META]: {
                    jobs,
                    handlers: {
                        ...handlers,
                        cleanup,
                    },
                },
            },
            { only: ['cleanup'], logger: silent }
        );
        await vi.advanceTimersByTimeAsync(61_000);
        scheduler.stop();
        await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1));
    });

    describe('a transport that schedules for itself', () => {
        const registering = () => {
            const registered: ScheduledJob[][] = [];
            return {
                registered,
                transport: createJobTransport({
                    name: 'pg-boss-ish',
                    dispatch: () => {},
                    register: (schedules) => {
                        registered.push([...schedules]);
                    },
                }),
            };
        };

        it('hands over every scheduled job, with its cron and time zone', async () => {
            const { registered, transport } = registering();
            startJobs(apiWith(transport), { logger: silent });
            await vi.advanceTimersByTimeAsync(0);
            expect(registered[0]).toEqual([
                {
                    job: 'cleanup',
                    cron: '0 3 * * *',
                    timezone: undefined,
                },
                {
                    job: 'reportDaily',
                    cron: '0 6 * * *',
                    timezone: 'Europe/Oslo',
                },
            ]);
        });

        it('does not tick anything itself', async () => {
            vi.setSystemTime(new Date('2026-08-05T02:59:00Z'));
            const { transport } = registering();
            const dispatch = vi.spyOn(transport, 'dispatch');
            startJobs(apiWith(transport), { logger: silent });
            await vi.advanceTimersByTimeAsync(2 * 24 * 60 * 60 * 1000);
            expect(dispatch).not.toHaveBeenCalled();
        });
    });

    it('refuses an api with no jobs, pointing at the fix', () => {
        expect(() => startJobs({}, { logger: silent })).toThrow('startJobs was given an api with no jobs');
    });
});
