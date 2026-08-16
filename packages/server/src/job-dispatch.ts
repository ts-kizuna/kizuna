import { dueSchedules, type JobSchedule } from '@ts-kizuna/contract';
import { flattenJobs } from '@ts-kizuna/contract';
import type { Contract } from '@ts-kizuna/contract';
import { ProblemDetailsSchema } from '@ts-kizuna/contract';
import { z } from 'zod';

export interface DispatchOptions {
    /**
     * When the tick happened.
     *
     * @default new Date()
     */
    at?: Date;
    /**
     * How far back the tick looks for due jobs. Widen it when the platform
     * delivers less punctually than its cron expression suggests, GitHub Actions
     * and Vercel both run late under load.
     *
     * @default 60000
     */
    windowMs?: number;
    /**
     * Run only these jobs, if they are due.
     */
    only?: readonly string[];
    /**
     * Never run these, however due they look.
     */
    exclude?: readonly string[];
}

export interface DispatchOutcome {
    job: string;
    status: 'ok' | 'failed';
    /**
     * Present when the job threw. The message only, never a stack.
     */
    detail?: string;
}

export interface DispatchResult {
    at: string;
    /**
     * Jobs whose schedule fell in this tick's window.
     */
    due: string[];
    ran: DispatchOutcome[];
}

/**
 * The jobs a contract has due as of a tick.
 */
export const dueJobs = (contract: Contract, options?: DispatchOptions): string[] => {
    const schedules: Record<string, JobSchedule> = {};
    for (const { jobKey, job } of flattenJobs(contract.jobs ?? {})) {
        if (options?.only && !options.only.includes(jobKey)) continue;
        if (options?.exclude?.includes(jobKey)) continue;
        if (job.schedule === undefined) continue;
        schedules[jobKey] = job.schedule;
    }
    return dueSchedules(schedules, {
        at: options?.at,
        windowMs: options?.windowMs,
    });
};

/**
 * Run every job a contract has due, and report what happened.
 *
 * Stateless: the clock comes from the tick, so a minute the platform fails to
 * deliver is a minute missed. A failing job is reported, not thrown.
 *
 * @example
 * const result = await dispatchDueJobs(contract, {
 *     sendDigests: async () => { await sendPendingDigests(); },
 * });
 */
export const dispatchDueJobs = async (
    contract: Contract,
    handlers: Record<string, () => Promise<unknown> | unknown>,
    options?: DispatchOptions
): Promise<DispatchResult> => {
    const at = options?.at ?? new Date();
    const due = dueJobs(contract, { ...options, at });
    const ran: DispatchOutcome[] = [];
    for (const job of due) {
        const handler = handlers[job];
        if (!handler) {
            ran.push({
                job,
                status: 'failed',
                detail: 'No handler was passed for this job.',
            });
            continue;
        }
        try {
            await handler();
            ran.push({
                job,
                status: 'ok',
            });
        } catch (error) {
            ran.push({
                job,
                status: 'failed',
                detail: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return {
        at: at.toISOString(),
        due,
        ran,
    };
};

/**
 * Whether every job in a tick succeeded. Drives the dispatch route's status.
 */
export const dispatchSucceeded = (result: DispatchResult): boolean => result.ran.every((outcome) => outcome.status === 'ok');

/**
 * The body the endpoint answers `200` with.
 */
export const DispatchResultSchema = z.object({
    at: z.string(),
    due: z.array(z.string()),
    ran: z.array(
        z.object({
            job: z.string(),
            status: z.enum(['ok', 'failed']),
            detail: z.string().optional(),
        })
    ),
});

/**
 * The body the run endpoint takes.
 */
export const JobRunRequestSchema = z.object({
    job: z.string(),
    input: z.unknown().optional(),
});

/**
 * The body the endpoint answers `503` with: RFC 9457 Problem Details plus
 * the names of the jobs that failed, as an extension member.
 */
export const DispatchFailedSchema = ProblemDetailsSchema.extend({
    failed: z.array(z.string()),
});

/**
 * The names of the jobs that failed in a tick.
 */
export const failedJobs = (result: DispatchResult): string[] =>
    result.ran.filter((outcome) => outcome.status === 'failed').map((outcome) => outcome.job);
