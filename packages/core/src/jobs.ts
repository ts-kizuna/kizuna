import { z } from 'zod';
import { ProblemDetailsSchema } from './error-response.js';
import { assertValidSchedule, type JobSchedule } from './schedule.js';
import type { ResponseDefinition } from './types.js';
import type { HandlerReturn } from './handler-pipeline.js';
import type { JobRunner as JobRunnerOf } from './job-runner.js';
import type { PathClaim } from './path-claims.js';

/**
 * The namespace the job endpoints are mounted under when `jobs.path` says
 * nothing.
 */
export const DEFAULT_JOBS_PATH = '/jobs';

/**
 * Settings shared by every job, passed to `new Kizuna()` under `jobs`. The jobs
 * themselves are declared with `k.jobs`.
 */
export interface JobsConfig {
    /**
     * The namespace both job endpoints are mounted under, `dispatch` and `run`
     * beneath it. Nothing is served on the namespace itself.
     *
     * @default '/jobs'
     */
    path?: `/${string}`;
    /**
     * `GET` instead of `POST`. Vercel Cron sends `GET` and nothing else.
     *
     * @default 'POST'
     */
    method?: 'POST' | 'GET';
    /**
     * How far back a tick looks for due jobs. Widen it when the scheduler
     * delivers late.
     *
     * @default 60000
     */
    windowMs?: number;
    /**
     * Dispatch only these jobs.
     */
    only?: readonly string[];
    /**
     * Never dispatch these.
     */
    exclude?: readonly string[];
}

/**
 * A scheduled job, as authored in `k.jobs`.
 */
export interface JobDefinition {
    /**
     * A five-field cron expression, or `{ cron, timezone }`. Validated when the
     * contract is built. Omit it for a job that is only ever queued from code.
     */
    schedule?: JobSchedule;
    /**
     * How many attempts a failed run deserves. Handed to the transport, which is
     * what retries.
     *
     * @default 1
     */
    retry?: number;
    summary?: string;
    description?: string;
    /**
     * Schema for the payload the job is queued with.
     */
    input?: z.ZodType;
    /**
     * Schema for what the job reports on success. Omit it and the job answers
     * `204`.
     */
    result?: z.ZodType;
    /**
     * Extra responses beyond the synthesized `200`/`204`, `422`, `500`, `503`.
     */
    responses?: {
        [status: number]: ResponseDefinition;
    };
}

/**
 * A job's synthesized responses. These are the retry contract: `503` asks for a
 * retry, `422` says the failure is permanent.
 */
export type JobResponses<Definition extends JobDefinition> = (Definition extends {
    result: z.ZodType;
}
    ? {
          200: Definition['result'];
      }
    : {
          204: z.ZodVoid;
      }) & {
    422: typeof ProblemDetailsSchema;
    500: typeof ProblemDetailsSchema;
    503: typeof ProblemDetailsSchema;
};

/**
 * A job after `k.jobs` compiles it.
 */
export interface CompiledJob<
    Definition extends JobDefinition = JobDefinition,
    IdentityName extends string | undefined = string | undefined,
> {
    definition: Definition;
    schedule: JobSchedule | undefined;
    /**
     * The identity every job in the group requires, or `undefined` when the group
     * was declared without one. It guards the dispatch endpoint.
     */
    identity: IdentityName;
    /**
     * The payload schema, or `undefined` when the job takes none.
     */
    input: z.ZodType | undefined;
    responses: JobResponses<Definition>;
}

/**
 * A contract's jobs. Nestable, like routes, so a large codebase can group them ,
 * `jobs.billing.reconcileInvoices`.
 */
export interface Jobs {
    [key: string]: CompiledJob | Jobs;
}

/**
 * The compiled form of an authored job tree, preserving its shape.
 */
export type CompiledJobs<Definitions extends AuthoredJobs, IdentityName extends string | undefined> = {
    [Name in keyof Definitions]: Definitions[Name] extends JobDefinition
        ? CompiledJob<Definitions[Name], IdentityName>
        : Definitions[Name] extends AuthoredJobs
          ? CompiledJobs<Definitions[Name], IdentityName>
          : never;
};

/**
 * The shape `k.jobs` accepts: jobs, or groups of them, to any depth.
 */
export interface AuthoredJobs {
    [key: string]: JobDefinition | AuthoredJobs;
}

export type JobHandlerReturn<Definition extends JobDefinition> = HandlerReturn<{
    responses: JobResponses<Definition>;
}>;

/**
 * The single object a job handler receives: its own input and `throwError`, and
 * nothing else. Anything more it imports, as a route handler would.
 */
export type JobHandlerArgs<Definition extends JobDefinition> = {
    /**
     * The validated payload, or `undefined` when the job declares no `input`.
     */
    input: Definition extends {
        input: z.ZodType;
    }
        ? z.output<Definition['input']>
        : undefined;
    /**
     * Throws a typed response. Takes the same `{ status, body }` shape as a
     * handler return.
     *
     * This function throws internally and never returns.
     */
    throwError: (response: JobHandlerReturn<Definition>) => never;
};

/**
 * A job declaring no `result` has only `204` to answer, so it may return nothing
 * at all.
 */
export type JobVoidReturn<Definition extends JobDefinition> = Definition extends {
    result: z.ZodType;
}
    ? never
    : void;

export type JobHandler<Job extends CompiledJob, Jobs_ extends Jobs = Jobs> = (
    args: JobHandlerArgs<Job['definition']> & JobsArg<Jobs_>
) =>
    | Promise<JobHandlerReturn<Job['definition']> | JobVoidReturn<Job['definition']>>
    | JobHandlerReturn<Job['definition']>
    | JobVoidReturn<Job['definition']>;

/**
 * The `jobs` argument every handler receives: the contract's jobs bound to their
 * handlers, so one can be run in process. Absent when the contract declares none.
 */
export type JobsArg<Jobs_ extends Jobs> = string extends keyof Jobs_
    ? {}
    : {
          jobs: JobRunnerOf<Jobs_>;
      };

/**
 * A job tree with no jobs in it, for a contract that declares none.
 */
export type NoJobs = Record<string, never>;

/**
 * The handlers `server.jobs` accepts: one per declared job, keyed by name.
 */
export type JobHandlers<Jobs_ extends Jobs, Root extends Jobs = Jobs_> = {
    [Name in keyof Jobs_]: Jobs_[Name] extends CompiledJob
        ? JobHandler<Jobs_[Name], Root>
        : Jobs_[Name] extends Jobs
          ? JobHandlers<Jobs_[Name], Root>
          : never;
};

const isPromise = (value: unknown): value is Promise<unknown> =>
    !!value && typeof value === 'object' && typeof (value as { then?: unknown }).then === 'function';

/**
 * Fill in the `204` a handler left off.
 */
export const toJobResponse = (result: unknown): unknown => {
    if (isPromise(result)) return result.then(toJobResponse);
    return result === undefined
        ? {
              status: 204,
              body: undefined,
          }
        : result;
};

const buildResponses = (definition: JobDefinition): Record<number, ResponseDefinition> => ({
    ...(definition.result ? { 200: definition.result } : { 204: z.void() }),
    422: ProblemDetailsSchema,
    500: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
    ...definition.responses,
});

const assertValidJob = (name: string, definition: JobDefinition): void => {
    if (definition.schedule !== undefined) assertValidSchedule(definition.schedule, name);
    if (definition.retry !== undefined && (!Number.isInteger(definition.retry) || definition.retry < 1)) {
        throw new Error(`Job "${name}" has \`retry: ${String(definition.retry)}\`, which must be a whole number of attempts, at least 1.`);
    }
    if (definition.schedule !== undefined && definition.input && !definition.input.safeParse(undefined).success) {
        throw new Error(
            `Job "${name}" has a schedule and an \`input\` that will not accept an empty payload. ` +
                `A scheduler has nothing to send, so give every field a default or make the job queue-only by dropping its schedule.`
        );
    }
};

/**
 * Every field a job may declare. A node carrying only these is a job; anything
 * else is a group of them.
 */
const JOB_FIELDS = ['schedule', 'retry', 'summary', 'description', 'input', 'result', 'responses'] as const;

/**
 * Whether one field is shaped the way a job declares it. Types are checked as
 * well as names, so a group named `summary` still reads as a group.
 */
const isJobField = (name: string, value: unknown): boolean => {
    switch (name) {
        case 'schedule':
            return (
                typeof value === 'string' ||
                (!!value && typeof value === 'object' && typeof (value as { cron?: unknown }).cron === 'string')
            );
        case 'retry':
            return typeof value === 'number';
        case 'summary':
        case 'description':
            return typeof value === 'string';
        case 'input':
        case 'result':
            return value instanceof z.ZodType;
        case 'responses':
            return !!value && typeof value === 'object';
        default:
            return false;
    }
};

/**
 * Whether a node in an authored tree is a job rather than a group of them.
 */
export const isJobDefinition = (value: unknown): value is JobDefinition => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.entries(value).every(([name, field]) => isJobField(name, field));
};

/**
 * Compile authored job definitions into {@link Jobs}, preserving nesting. Backs
 * `k.jobs`.
 */
export const buildJobs = (identity: string | undefined, definitions: AuthoredJobs): Jobs => {
    const walk = (nodes: AuthoredJobs, prefix: string): Jobs => {
        const jobs: Jobs = {};
        for (const [name, node] of Object.entries(nodes)) {
            const jobKey = prefix ? `${prefix}.${name}` : name;
            if (isJobDefinition(node)) {
                assertValidJob(jobKey, node);
                jobs[name] = {
                    definition: node,
                    schedule: node.schedule,
                    identity,
                    input: node.input,
                    responses: buildResponses(node),
                } as unknown as CompiledJob;
                continue;
            }
            if (!node || typeof node !== 'object' || Array.isArray(node)) {
                throw new Error(`Job "${jobKey}" is not an object. A job declares ${JOB_FIELDS.join(', ')}; a group declares more jobs.`);
            }
            jobs[name] = walk(node as AuthoredJobs, jobKey);
        }
        return jobs;
    };

    return walk(definitions, '');
};

export interface FlattenedJob {
    /**
     * Dotted path to the job, e.g. `billing.reconcileInvoices`. It is how every
     * other part of the system names a job.
     */
    jobKey: string;
    job: CompiledJob;
}

/**
 * Every job in a tree, with its dotted key.
 */
export const flattenJobs = (jobs: Jobs, prefix = ''): FlattenedJob[] => {
    const collected: FlattenedJob[] = [];
    for (const [name, node] of Object.entries(jobs)) {
        const jobKey = prefix ? `${prefix}.${name}` : name;
        if (isCompiledJob(node)) {
            collected.push({ jobKey, job: node });
        } else if (node && typeof node === 'object') {
            collected.push(...flattenJobs(node as Jobs, jobKey));
        }
    }
    return collected;
};

/**
 * The job at a dotted key, or `undefined`.
 */
export const jobAt = (jobs: Jobs, jobKey: string): CompiledJob | undefined => {
    let current: Jobs | CompiledJob | undefined = jobs;
    for (const segment of jobKey.split('.')) {
        if (!current || typeof current !== 'object' || isCompiledJob(current)) return undefined;
        current = (current as Jobs)[segment];
    }
    return isCompiledJob(current) ? current : undefined;
};

export const isCompiledJob = (value: unknown): value is CompiledJob => {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Record<string, unknown>;
    return !!candidate.definition && !!candidate.responses;
};

/**
 * Throws when either job endpoint lands on a path an API route already serves.
 * Called by `k.contract`, the one place that sees both.
 */
export const jobClaims = (jobs: Jobs | undefined, config: JobsConfig | undefined): PathClaim[] => {
    if (!jobs || flattenJobs(jobs).length === 0) return [];
    const base = config?.path ?? DEFAULT_JOBS_PATH;
    return [
        {
            method: config?.method ?? 'POST',
            path: `${base}/dispatch`,
        },
        {
            method: 'POST',
            path: `${base}/run`,
        },
    ].map((endpoint) => ({
        kind: 'Jobs endpoint',
        key: endpoint.path,
        method: endpoint.method,
        path: endpoint.path,
    }));
};
