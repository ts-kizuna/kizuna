import { flattenJobs } from './adapter.js';
import { DEFAULT_JOBS_PATH } from '@ts-kizuna/contract/internal';
import type { Contract } from '@ts-kizuna/contract/internal';

export interface JobsDevRunnerOptions {
    /**
     * Where the running server is reachable, e.g. `'http://localhost:8000'`.
     */
    baseUrl: string;
    /**
     * Prefix the dispatch path with this, matching where the API is mounted.
     */
    basePath?: string;
    /**
     * The bearer token the jobs' guard expects.
     */
    secret?: string;
    /**
     * How often to tick, matching how often your platform cron will.
     *
     * @default 60000
     */
    intervalMs?: number;
    /**
     * Called after each tick.
     */
    onTick?: (outcome: { status: number } | { error: unknown }) => void;
    /**
     * Where progress goes.
     *
     * @default console
     */
    logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

export interface JobsDevRunner {
    /**
     * Cancel every pending tick.
     */
    stop: () => void;
    /**
     * Tick now, without waiting for the interval.
     */
    trigger: () => Promise<{ status: number }>;
}

const stripTrailingSlash = (url: string): string => (url.endsWith('/') ? url.slice(0, -1) : url);

/**
 * Tick the dispatch endpoint over the network on an interval, so `pnpm dev`
 * exercises the same request your platform cron will make in production.
 *
 * Reach for `startJobs` instead when you schedule in-process: it reads each job's
 * own schedule rather than ticking on a fixed interval.
 *
 * @example
 * if (process.env.NODE_ENV !== 'production') {
 *     startJobsDevRunner(contract, {
 *         baseUrl: `http://localhost:${port}`,
 *         secret: process.env.CRON_SECRET,
 *     });
 * }
 */
export const startJobsDevRunner = (contract: Contract, options: JobsDevRunnerOptions): JobsDevRunner => {
    const logger = options.logger ?? console;
    if (process.env.NODE_ENV === 'production') {
        logger.warn(
            '[ts-kizuna/schedule] startJobsDevRunner is running with NODE_ENV=production. ' +
                'It ticks on an interval held in memory, so any tick during a restart or deploy is missed silently. ' +
                'Use your platform scheduler in production.'
        );
    }

    const method = contract.jobsConfig?.method ?? 'POST';
    const path = `${options.basePath ?? ''}${contract.jobsConfig?.path ?? DEFAULT_JOBS_PATH}/dispatch`;
    const url = `${stripTrailingSlash(options.baseUrl)}${path}`;
    const intervalMs = options.intervalMs ?? 60_000;

    const trigger = async (): Promise<{ status: number }> => {
        const response = await fetch(url, {
            method,
            headers: options.secret === undefined ? {} : { authorization: `Bearer ${options.secret}` },
        });
        return {
            status: response.status,
        };
    };

    const timer = setInterval(() => {
        void trigger()
            .then((outcome) => {
                logger.log(`[ts-kizuna/schedule] ${method} ${path} -> ${outcome.status}`);
                options.onTick?.(outcome);
            })
            .catch((error: unknown) => {
                logger.error(`[ts-kizuna/schedule] ${method} ${path} failed:`, error);
                options.onTick?.({ error });
            });
    }, intervalMs);
    timer.unref?.();

    const scheduled = flattenJobs(contract.jobs ?? {}).filter(({ job }) => job.schedule !== undefined).length;
    logger.warn(
        `[ts-kizuna/schedule] Dev runner ticking ${method} ${path} every ${intervalMs}ms for ${scheduled} scheduled job(s). ` +
            'Ticks are missed while the process is down.'
    );

    return {
        stop: () => {
            clearInterval(timer);
        },
        trigger,
    };
};
