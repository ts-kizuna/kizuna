import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Kizuna } from '@ts-kizuna/contract';
import type { Contract } from '@ts-kizuna/contract';
import { dispatchDueJobs, dispatchSucceeded, dueJobs } from './job-dispatch.js';

const scheduler = Kizuna.identity.bearer({});

const k = new Kizuna({
    identities: {
        scheduler,
    },
});

const jobs = k.jobs('scheduler', {
    everyMinute: {
        schedule: '* * * * *',
    },
    fiveAm: {
        schedule: '0 5 * * *',
    },
    quarterHour: {
        schedule: '*/15 * * * *',
    },
    never: {
        schedule: '0 0 30 2 *',
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
}) as unknown as Contract;

const at = (iso: string): Date => new Date(iso);

describe('dueJobs', () => {
    it('reports the jobs whose minute just passed', () => {
        expect(dueJobs(contract, { at: at('2026-08-05T05:00:00Z') }).sort()).toEqual(['everyMinute', 'fiveAm', 'quarterHour']);
    });

    it('leaves out jobs not due this minute', () => {
        expect(dueJobs(contract, { at: at('2026-08-05T05:07:00Z') })).toEqual(['everyMinute']);
    });

    it('never reports a schedule that cannot occur', () => {
        expect(dueJobs(contract, { at: at('2026-02-28T00:00:00Z') })).not.toContain('never');
    });

    it('honours `only`', () => {
        expect(dueJobs(contract, { at: at('2026-08-05T05:00:00Z'), only: ['fiveAm'] })).toEqual(['fiveAm']);
    });

    it('widens with the window, so a late tick still catches the job', () => {
        // The tick lands two minutes after 05:00, past the default window.
        expect(dueJobs(contract, { at: at('2026-08-05T05:02:00Z') })).not.toContain('fiveAm');
        expect(dueJobs(contract, { at: at('2026-08-05T05:02:00Z'), windowMs: 5 * 60_000 })).toContain('fiveAm');
    });

    it('reports nothing for a contract with no jobs', () => {
        const bare = k.contract({
            routes: k.routes({}),
        }) as unknown as Contract;
        expect(dueJobs(bare, { at: at('2026-08-05T05:00:00Z') })).toEqual([]);
    });
});

describe('dispatchDueJobs', () => {
    it('runs only the due jobs', async () => {
        const everyMinute = vi.fn();
        const fiveAm = vi.fn();
        const result = await dispatchDueJobs(
            contract,
            {
                everyMinute,
                fiveAm,
                quarterHour: vi.fn(),
                never: vi.fn(),
            },
            { at: at('2026-08-05T05:07:00Z') }
        );
        expect(everyMinute).toHaveBeenCalledTimes(1);
        expect(fiveAm).not.toHaveBeenCalled();
        expect(result.ran).toEqual([
            {
                job: 'everyMinute',
                status: 'ok',
            },
        ]);
        expect(dispatchSucceeded(result)).toBe(true);
    });

    it('awaits an async job', async () => {
        const order: string[] = [];
        await dispatchDueJobs(
            contract,
            {
                everyMinute: async () => {
                    await Promise.resolve();
                    order.push('done');
                },
            },
            { at: at('2026-08-05T05:07:00Z') }
        );
        expect(order).toEqual(['done']);
    });

    it('reports a failing job without stopping the tick', async () => {
        const quarterHour = vi.fn();
        const result = await dispatchDueJobs(
            contract,
            {
                everyMinute: () => {
                    throw new Error('Provider is down');
                },
                fiveAm: vi.fn(),
                quarterHour,
            },
            { at: at('2026-08-05T05:00:00Z') }
        );
        expect(quarterHour).toHaveBeenCalledTimes(1);
        expect(result.ran).toContainEqual({
            job: 'everyMinute',
            status: 'failed',
            detail: 'Provider is down',
        });
        expect(dispatchSucceeded(result)).toBe(false);
    });

    it('reports a due job with no handler', async () => {
        const result = await dispatchDueJobs(contract, {}, { at: at('2026-08-05T05:07:00Z') });
        expect(result.ran).toEqual([
            {
                job: 'everyMinute',
                status: 'failed',
                detail: 'No handler was passed for this job.',
            },
        ]);
        expect(dispatchSucceeded(result)).toBe(false);
    });

    it('succeeds vacuously when nothing is due', async () => {
        const bare = k.contract({
            routes: k.routes({}),
        }) as unknown as Contract;
        const result = await dispatchDueJobs(bare, {}, { at: at('2026-08-05T05:00:00Z') });
        expect(result.due).toEqual([]);
        expect(dispatchSucceeded(result)).toBe(true);
    });

    it('stamps the tick it ran for', async () => {
        const result = await dispatchDueJobs(contract, { everyMinute: vi.fn() }, { at: at('2026-08-05T05:07:00Z') });
        expect(result.at).toBe('2026-08-05T05:07:00.000Z');
    });
});
