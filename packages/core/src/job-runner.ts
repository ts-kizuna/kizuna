import { isCompiledJob, jobAt, toJobResponse, type CompiledJob, type JobHandlerReturn, type JobHandlers, type Jobs } from './jobs.js';
import { ResponseError } from './response-error.js';
import type { JobMessage, JobTransport } from './job-transport.js';
import type { z } from 'zod';

/**
 * The arguments a job takes when run in code: its input when it declares one,
 * nothing otherwise.
 */
export type JobRunArgs<Job extends CompiledJob> = Job['definition'] extends {
    input: z.ZodType;
}
    ? [input: z.input<Job['definition']['input']>]
    : [];

/**
 * What `queue` takes: the job's input when it declares one, alongside how the
 * message should be delivered.
 */
export type JobQueueArgs<Job extends CompiledJob> = Job['definition'] extends {
    input: z.ZodType;
}
    ? [
          message: {
              input: z.input<Job['definition']['input']>;
          } & JobQueueOptions,
      ]
    : [message?: JobQueueOptions];

export interface JobQueueOptions {
    /**
     * Hold the job until this time. Honoured by transports declaring
     * `supports.runAt`.
     */
    runAt?: Date;
    /**
     * Run this at most once, however many times it is queued. Honoured by
     * transports declaring `supports.dedupe`.
     */
    dedupeKey?: string;
}

/**
 * One job, reachable two ways.
 */
export interface JobFn<Job extends CompiledJob> {
    /**
     * Run the job now and resolve to what its handler returned.
     */
    run: (...args: JobRunArgs<Job>) => Promise<JobHandlerReturn<Job['definition']>>;
    /**
     * Put the job in line and answer without waiting for it. With no transport
     * configured the job runs in this process and is lost on a crash.
     */
    queue: (...args: JobQueueArgs<Job>) => Promise<void>;
}

/**
 * A contract's jobs, shaped exactly like the declaration.
 *
 * @example
 * await jobs.billing.reconcileInvoices.run({ since });
 * await jobs.indexUser.queue({
 *     input: {
 *         userId,
 *     },
 * });
 */
export type JobRunner<Jobs_ extends Jobs> = {
    [Name in keyof Jobs_]: Jobs_[Name] extends CompiledJob ? JobFn<Jobs_[Name]> : Jobs_[Name] extends Jobs ? JobRunner<Jobs_[Name]> : never;
};

export class JobInputError extends Error {
    readonly job: string;
    readonly issues: z.core.$ZodIssue[];

    constructor(job: string, issues: z.core.$ZodIssue[]) {
        super(`Input for job "${job}" failed validation.`);
        this.name = 'JobInputError';
        this.job = job;
        this.issues = issues;
    }
}

/**
 * Called when a job queued without a transport rejects. Without one, the
 * failure is logged.
 */
export type JobErrorHandler = (job: string, error: unknown) => void;

export interface JobRunnerOptions {
    /**
     * Carries a queued job to whatever runs it. Without one, `queue` runs the job
     * in this process without waiting for it.
     */
    transport?: JobTransport;
    onError?: JobErrorHandler;
}

/**
 * A job's `run` and `queue` reached by dotted key. Untyped, because a caller
 * holding a key does not know it statically.
 */
export interface JobFnByKey {
    run: (input?: unknown) => Promise<unknown>;
    queue: (message?: JobQueueOptions & { input?: unknown }) => Promise<void>;
}

/**
 * Walk a {@link JobRunner} tree to the pair for one dotted key.
 */
export const jobFnAt = (runner: unknown, jobKey: string): JobFnByKey | undefined => {
    let node: unknown = runner;
    for (const segment of jobKey.split('.')) {
        if (!node || typeof node !== 'object') return undefined;
        node = (node as Record<string, unknown>)[segment];
    }
    const candidate = node as { run?: unknown; queue?: unknown } | undefined;
    return typeof candidate?.run === 'function' && typeof candidate.queue === 'function' ? (candidate as JobFnByKey) : undefined;
};

const handlerAt = (handlers: unknown, jobKey: string): unknown => {
    let current: unknown = handlers;
    for (const segment of jobKey.split('.')) {
        if (!current || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[segment];
    }
    return current;
};

/**
 * Bind a contract's jobs to their handlers so they can be run from anywhere.
 *
 * Every handler already receives this as `jobs`, so reach for it directly only
 * outside a request: in a script, a seed, or a test.
 *
 * @example
 * const jobs = createJobRunner(contract, jobHandlers);
 *
 * await jobs.billing.reconcileInvoices.run({ since: '2026-08-01' });
 * await jobs.indexUser.queue({
 *     input: {
 *         userId: user.id,
 *     },
 * });
 */
export const createJobRunner = <Jobs_ extends Jobs>(
    source:
        | Jobs_
        | {
              jobs?: Jobs_;
          },
    handlers: JobHandlers<Jobs_>,
    options?: JobRunnerOptions
): JobRunner<Jobs_> => {
    const jobs = (source && 'jobs' in source ? ((source.jobs ?? {}) as Jobs_) : (source as Jobs_)) ?? ({} as Jobs_);

    const jobFor = (jobKey: string): CompiledJob => {
        const job = jobAt(jobs, jobKey);
        if (!job) throw new Error(`No job named "${jobKey}" on this contract.`);
        return job;
    };

    const validateInput = (job: CompiledJob, jobKey: string, input: unknown): unknown => {
        const schema = job.input;
        if (!schema) return undefined;
        const parsed = schema.safeParse(input);
        if (!parsed.success) throw new JobInputError(jobKey, parsed.error.issues);
        return parsed.data;
    };

    const invoke = async (jobKey: string, input: unknown): Promise<unknown> => {
        const job = jobFor(jobKey);
        const handler = handlerAt(handlers, jobKey);
        if (typeof handler !== 'function') throw new Error(`No handler was bound for job "${jobKey}".`);

        return toJobResponse(
            (handler as (args: unknown) => unknown)({
                input: validateInput(job, jobKey, input),
                throwError: (response: never): never => {
                    throw new ResponseError(response);
                },
                jobs: tree,
            })
        );
    };

    const runDetached = (jobKey: string, input: unknown, runAt: Date | undefined): void => {
        const start = (): void => {
            void invoke(jobKey, input).catch((error: unknown) => {
                if (options?.onError) {
                    options.onError(jobKey, error);
                    return;
                }
                console.error(`[ts-kizuna] Queued job "${jobKey}" failed:`, error);
            });
        };
        const delay = runAt ? runAt.getTime() - Date.now() : 0;
        if (delay <= 0) {
            start();
            return;
        }
        setTimeout(start, delay).unref?.();
    };

    /**
     * Once per job and option: a `queue` in a loop should not bury the log.
     */
    const warned = new Set<string>();
    const warnDropped = (jobKey: string, transportName: string, option: string, consequence: string): void => {
        if (warned.has(`${jobKey}:${option}`)) return;
        warned.add(`${jobKey}:${option}`);
        console.warn(
            `[ts-kizuna] Job "${jobKey}" was queued with \`${option}\`, but the "${transportName}" transport does not honour it, so it ${consequence}.`
        );
    };

    const queue = async (jobKey: string, message: (JobQueueOptions & { input?: unknown }) | undefined): Promise<void> => {
        const job = jobFor(jobKey);
        const input = validateInput(job, jobKey, message?.input);
        const transport = options?.transport;
        if (!transport) {
            runDetached(jobKey, input, message?.runAt);
            return;
        }
        if (message?.runAt && !transport.supports.runAt) warnDropped(jobKey, transport.name, 'runAt', 'runs it as soon as it is delivered');
        if (message?.dedupeKey && !transport.supports.dedupe) warnDropped(jobKey, transport.name, 'dedupeKey', 'may run it more than once');
        const outgoing: JobMessage = {
            job: jobKey,
            input,
            runAt: message?.runAt,
            dedupeKey: message?.dedupeKey,
            retry: job.definition.retry,
        };
        await transport.dispatch(outgoing);
    };

    const buildTree = (nodes: Jobs, prefix: string): Record<string, unknown> => {
        const result: Record<string, unknown> = {};
        for (const [name, node] of Object.entries(nodes)) {
            const jobKey = prefix ? `${prefix}.${name}` : name;
            if (isCompiledJob(node)) {
                result[name] = {
                    run: (input?: unknown) => invoke(jobKey, input),
                    queue: (message?: JobQueueOptions & { input?: unknown }) => queue(jobKey, message),
                };
            } else if (node && typeof node === 'object') {
                result[name] = buildTree(node as Jobs, jobKey);
            }
        }
        return result;
    };

    const tree = buildTree(jobs, '') as JobRunner<Jobs_>;
    return tree;
};
