/**
 * One job, ready to deliver. The input is already validated, so a transport
 * never looks at a schema.
 */
export interface JobMessage {
    /**
     * The job's dotted key, e.g. `billing.reconcileInvoices`. It is how the
     * message is addressed: a job has no URL of its own.
     */
    job: string;
    /**
     * The validated input, or `undefined` when the job declares none. JSON-safe.
     */
    input: unknown;
    /**
     * Hold delivery until this time.
     */
    runAt?: Date;
    /**
     * Deliver at most one message carrying this key.
     */
    dedupeKey?: string;
    /**
     * How many attempts the job declared. Backoff is the transport's own.
     */
    retry?: number;
}

/**
 * What a transport honours. `server.api` warns when a job asks for something
 * left out.
 */
export interface JobTransportSupports {
    retry?: boolean;
    dedupe?: boolean;
    runAt?: boolean;
}

export interface JobDescriptor {
    /**
     * The job's dotted key.
     */
    job: string;
}

export interface ScheduledJob extends JobDescriptor {
    /**
     * A five-field cron expression.
     */
    cron: string;
    /**
     * IANA time zone the expression is read in, or `undefined` for UTC.
     */
    timezone: string | undefined;
}

export interface JobWorker {
    stop: () => Promise<void> | void;
}

export interface JobWorkerContext {
    /**
     * Every job the contract declares, to subscribe by name.
     */
    jobs: readonly JobDescriptor[];
    /**
     * Run one message through the same handler a route would reach. Let its
     * rejection propagate: that is how the transport learns to retry.
     */
    run: (message: JobMessage) => Promise<void>;
}

export interface JobTransportDefinition {
    name: string;
    supports?: JobTransportSupports;
    /**
     * Deliver one job. Resolve once the message is handed over, not once the job
     * has run; reject when it could not be handed over at all.
     */
    dispatch: (message: JobMessage) => Promise<void> | void;
    /**
     * Drain stored work, for a transport that is pulled rather than pushed.
     */
    start?: (context: JobWorkerContext) => Promise<JobWorker>;
    /**
     * Take scheduling over, for a transport with a scheduler of its own.
     * `startJobs` then hands the schedules across instead of ticking them.
     */
    register?: (schedules: readonly ScheduledJob[]) => Promise<void> | void;
}

export interface JobTransport extends JobTransportDefinition {
    readonly supports: JobTransportSupports;
}

export class JobDispatchError extends Error {
    readonly transport: string;
    readonly job: string;

    constructor(transport: string, job: string, cause: unknown) {
        super(`Transport "${transport}" could not queue job "${job}".`, {
            cause,
        });
        this.name = 'JobDispatchError';
        this.transport = transport;
        this.job = job;
    }
}

/**
 * Define a transport: what carries a queued job to whatever runs it.
 *
 * @example
 * export const pgBoss = (boss: PgBoss) =>
 *     createJobTransport({
 *         name: 'pg-boss',
 *         supports: {
 *             retry: true,
 *             dedupe: true,
 *             runAt: true,
 *         },
 *         dispatch: async (message) => {
 *             await boss.send(message.job, message.input ?? {}, {
 *                 startAfter: message.runAt,
 *                 singletonKey: message.dedupeKey,
 *                 retryLimit: message.retry,
 *             });
 *         },
 *         start: async ({ jobs, run }) => {
 *             for (const { job } of jobs) {
 *                 await boss.work(job, async ([queued]) => {
 *                     await run({
 *                         job,
 *                         input: queued.data,
 *                     });
 *                 });
 *             }
 *             return {
 *                 stop: () => boss.stop(),
 *             };
 *         },
 *     });
 */
export const createJobTransport = (definition: JobTransportDefinition): JobTransport => {
    if (!definition.name) throw new Error('createJobTransport needs a `name`.');
    return {
        ...definition,
        supports: definition.supports ?? {},
        dispatch: async (message) => {
            try {
                await definition.dispatch(message);
            } catch (error) {
                throw new JobDispatchError(definition.name, message.job, error);
            }
        },
    };
};
