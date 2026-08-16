import { nextRun, scheduleExpression, scheduleTimezone, type JobSchedule } from '@ts-kizuna/contract/internal';
import { flattenJobs, jobFnAt, jobRunnerFrom, JOBS_META, type JobsMeta, type ScheduledJob } from './adapter.js';

export interface StartJobsOptions {
    /**
     * Tick only these jobs, by dotted key.
     */
    only?: readonly string[];
    /**
     * Never tick these.
     */
    exclude?: readonly string[];
    /**
     * Called after each occurrence is queued, or when queueing it failed.
     */
    onTick?: (jobKey: string, outcome: { queuedAt: Date } | { error: unknown }) => void;
    /**
     * Where progress goes.
     *
     * @default console
     */
    logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

export interface JobScheduler {
    /**
     * Cancel every pending tick.
     */
    stop: () => void;
}

/**
 * The dedupe key an occurrence gets. Every instance ticking the same minute
 * produces the same string, so a deduplicating transport collapses them.
 */
export const occurrenceKey = (jobKey: string, occurrence: Date): string => `${jobKey}@${occurrence.toISOString()}`;

/**
 * Tick a contract's scheduled jobs in this process, queueing each occurrence.
 *
 * A transport implementing `register` takes scheduling over instead, and nothing
 * is ticked here.
 *
 * Every replica ticks. Each occurrence carries the same {@link occurrenceKey},
 * so a deduplicating transport turns those into one run; without one, run a
 * single instance.
 *
 * @example
 * api.mount(app);
 * startJobs(api);
 */
export const startJobs = (api: unknown, options?: StartJobsOptions): JobScheduler => {
    const logger = options?.logger ?? console;
    const meta = (api as Record<symbol, unknown> | undefined)?.[JOBS_META] as JobsMeta | undefined;
    if (!meta) {
        throw new Error(
            'startJobs was given an api with no jobs. Declare them with `k.jobs` and pass their handlers to `server.api({ jobs })`.'
        );
    }

    const scheduled = flattenJobs(meta.jobs)
        .filter(({ jobKey, job }) => {
            if (job.schedule === undefined) return false;
            if (options?.only && !options.only.includes(jobKey)) return false;
            return !options?.exclude?.includes(jobKey);
        })
        .map(({ jobKey, job }) => ({
            jobKey,
            schedule: job.schedule as JobSchedule,
        }));

    const transport = meta.transport;

    if (transport?.register) {
        const schedules: ScheduledJob[] = scheduled.map(({ jobKey, schedule }) => ({
            job: jobKey,
            cron: scheduleExpression(schedule),
            timezone: scheduleTimezone(schedule),
        }));
        void Promise.resolve(transport.register(schedules)).catch((error: unknown) => {
            logger.error(`[ts-kizuna] The "${transport.name}" transport could not take the schedules over:`, error);
        });
        logger.log(`[ts-kizuna] ${schedules.length} schedule(s) handed to the "${transport.name}" transport.`);
        return {
            stop: () => {},
        };
    }

    const runner = jobRunnerFrom(meta);
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    let stopped = false;

    const scheduleNext = (jobKey: string, schedule: JobSchedule, from: Date): void => {
        if (stopped) return;
        const occurrence = nextRun(schedule, from);
        if (occurrence === undefined) {
            logger.warn(`[ts-kizuna] Job "${jobKey}" has a schedule that never fires: ${scheduleExpression(schedule)}`);
            return;
        }
        const timer = setTimeout(
            () => {
                const jobFn = jobFnAt(runner, jobKey);
                if (!jobFn) {
                    logger.warn(`[ts-kizuna] No handler was bound for job "${jobKey}", so its schedule does nothing.`);
                    return;
                }
                void jobFn
                    .queue({
                        dedupeKey: occurrenceKey(jobKey, occurrence),
                    })
                    .then(() => {
                        options?.onTick?.(jobKey, {
                            queuedAt: occurrence,
                        });
                    })
                    .catch((error: unknown) => {
                        logger.error(`[ts-kizuna] Queueing "${jobKey}" for ${occurrence.toISOString()} failed:`, error);
                        options?.onTick?.(jobKey, { error });
                    })
                    .finally(() => {
                        scheduleNext(jobKey, schedule, occurrence);
                    });
            },
            Math.max(occurrence.getTime() - Date.now(), 0)
        );
        timer.unref?.();
        timers.set(jobKey, timer);
    };

    const now = new Date();
    for (const { jobKey, schedule } of scheduled) {
        const occurrence = nextRun(schedule, now);
        logger.log(
            `[ts-kizuna] ${jobKey} on "${scheduleExpression(schedule)}"` +
                (occurrence ? `, next at ${occurrence.toISOString()}` : ', which never fires')
        );
        scheduleNext(jobKey, schedule, now);
    }

    return {
        stop: () => {
            stopped = true;
            for (const timer of timers.values()) clearTimeout(timer);
            timers.clear();
        },
    };
};
