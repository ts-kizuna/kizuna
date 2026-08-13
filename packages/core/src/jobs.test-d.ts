import { expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { Kizuna } from './kizuna.js';
import type { JobHandlerArgs, JobHandlerReturn, JobHandlers } from './jobs.js';

const scheduler = Kizuna.identity.bearer({
    context: z.object({
        invokedBy: z.string(),
    }),
});

const analytics = Kizuna.requestContext(
    z.object({
        sessionId: z.string().nullable(),
    })
);

const k = new Kizuna({
    identities: {
        scheduler,
    },
    requestContext: {
        analytics,
    },
});

const jobs = k.jobs('scheduler', {
    sendDigests: {
        schedule: '0 5 * * *',
        result: z.object({
            sent: z.int(),
        }),
    },
    reconcile: {
        input: z.object({
            since: z.string(),
        }),
        result: z.object({
            reconciled: z.int(),
        }),
    },
    cleanup: {
        schedule: '0 3 * * *',
    },
});

type SendDigests = (typeof jobs)['sendDigests']['definition'];
type Reconcile = (typeof jobs)['reconcile']['definition'];
type Cleanup = (typeof jobs)['cleanup']['definition'];

test('input is undefined when the job declares none', () => {
    expectTypeOf<JobHandlerArgs<SendDigests>['input']>().toEqualTypeOf<undefined>();
});

test('input is the validated payload when the job declares one', () => {
    expectTypeOf<JobHandlerArgs<Reconcile>['input']>().toEqualTypeOf<{ since: string }>();
});

test('a job with a result returns 200 with that body', () => {
    type Return = JobHandlerReturn<SendDigests>;
    expectTypeOf<{ status: 200; body: { sent: number } }>().toExtend<Return>();
});

test('a job with no result returns 204', () => {
    type Return = JobHandlerReturn<Cleanup>;
    expectTypeOf<{ status: 204; body: void }>().toExtend<Return>();
    // 200 is not a status this job declares.
    expectTypeOf<{ status: 200; body: undefined }>().not.toExtend<Return>();
});

test('the retry contract statuses take a problem details detail', () => {
    type Return = JobHandlerReturn<Cleanup>;
    expectTypeOf<{ status: 503; body: { detail: string } }>().toExtend<Return>();
    expectTypeOf<{ status: 422; body: { detail: string } }>().toExtend<Return>();
    expectTypeOf<{ status: 500; body: { detail: string } }>().toExtend<Return>();
});

test('the adapter-filled envelope fields are rejected on an error body', () => {
    type Return = JobHandlerReturn<Cleanup>;
    expectTypeOf<{ status: 503; body: { detail: string; title: string } }>().not.toExtend<Return>();
    expectTypeOf<{ status: 503; body: { detail: string; status: number } }>().not.toExtend<Return>();
});

test('a status the job never declares is rejected', () => {
    type Return = JobHandlerReturn<Cleanup>;
    expectTypeOf<{ status: 418; body: { detail: string } }>().not.toExtend<Return>();
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
    access: {
        listUsers: false,
    },
});

type ContractJobs = NonNullable<(typeof contract)['jobs']>;
type Handlers = JobHandlers<ContractJobs>;

test('every declared job needs a handler', () => {
    expectTypeOf<keyof Handlers>().toEqualTypeOf<'sendDigests' | 'reconcile' | 'cleanup'>();
});

test('a job handler receives nothing but input, throwError, and jobs', () => {
    type Args = Parameters<Handlers['cleanup']>[0];
    expectTypeOf<keyof Args>().toEqualTypeOf<'input' | 'throwError' | 'jobs'>();
});

test('a job handler receives no request, response, or auth', () => {
    type Args = Parameters<Handlers['cleanup']>[0];
    expectTypeOf<Args>().not.toHaveProperty('req');
    expectTypeOf<Args>().not.toHaveProperty('res');
    expectTypeOf<Args>().not.toHaveProperty('auth');
    expectTypeOf<Args>().not.toHaveProperty('requestContext');
});

test('a job handler receives no route args', () => {
    type Args = Parameters<Handlers['cleanup']>[0];
    expectTypeOf<Args>().not.toHaveProperty('params');
    expectTypeOf<Args>().not.toHaveProperty('query');
    expectTypeOf<Args>().not.toHaveProperty('headers');
    expectTypeOf<Args>().not.toHaveProperty('body');
});

test('a job can run its siblings, as a callable tree', () => {
    type Args = Parameters<Handlers['cleanup']>[0];
    expectTypeOf<keyof Args['jobs']>().toEqualTypeOf<'sendDigests' | 'reconcile' | 'cleanup'>();
});

test('a job is run with its input, or with nothing', () => {
    type Args = Parameters<Handlers['cleanup']>[0];
    const jobs = {} as Args['jobs'];
    expectTypeOf(jobs.reconcile.run).parameters.toEqualTypeOf<[{ since: string }]>();
    expectTypeOf(jobs.cleanup.run).parameters.toEqualTypeOf<[]>();
});

test('queueing takes a message, and the input is required only when the job declares one', () => {
    type Args = Parameters<Handlers['cleanup']>[0];
    const jobs = {} as Args['jobs'];
    expectTypeOf(jobs.reconcile.queue).parameter(0).toHaveProperty('input');
    expectTypeOf(jobs.reconcile.queue).parameter(0).toExtend<{ runAt?: Date; dedupeKey?: string }>();
    expectTypeOf(jobs.cleanup.queue).parameter(0).toExtend<{ runAt?: Date; dedupeKey?: string } | undefined>();
    expectTypeOf(jobs.cleanup.queue).returns.toEqualTypeOf<Promise<void>>();
});

test('a job run resolves to what its handler returns', () => {
    type Args = Parameters<Handlers['cleanup']>[0];
    const jobs = {} as Args['jobs'];
    type SendDigestsResult = Awaited<ReturnType<typeof jobs.sendDigests.run>>;
    expectTypeOf<{ status: 200; body: { sent: number } }>().toExtend<SendDigestsResult>();
});

test('a nested job tree keeps its shape', () => {
    const nested = k.jobs('scheduler', {
        billing: {
            reconcileInvoices: {
                input: z.object({
                    since: z.string(),
                }),
            },
        },
    });
    const nestedContract = k.contract({
        routes: k.routes({}),
        jobs: nested,
    });
    type NestedHandlers = JobHandlers<NonNullable<(typeof nestedContract)['jobs']>>;
    expectTypeOf<keyof NestedHandlers>().toEqualTypeOf<'billing'>();
    expectTypeOf<keyof NestedHandlers['billing']>().toEqualTypeOf<'reconcileInvoices'>();
    type Args = Parameters<NestedHandlers['billing']['reconcileInvoices']>[0];
    expectTypeOf<Args['input']>().toEqualTypeOf<{ since: string }>();
    expectTypeOf(({} as Args['jobs']).billing.reconcileInvoices.run).parameters.toEqualTypeOf<[{ since: string }]>();
});

test('jobs declared without an identity still get a runner', () => {
    const bare = new Kizuna({
        identities: {
            scheduler,
        },
    });
    const publicJobs = bare.jobs({
        cleanup: {
            schedule: '0 3 * * *',
        },
    });
    const bareContract = bare.contract({
        routes: bare.routes({}),
        jobs: publicJobs,
    });
    type BareHandlers = JobHandlers<NonNullable<(typeof bareContract)['jobs']>>;
    type Args = Parameters<BareHandlers['cleanup']>[0];
    expectTypeOf<Args>().not.toHaveProperty('auth');
    expectTypeOf<Args>().toHaveProperty('jobs');
});

test('a handler may be async or sync', () => {
    const handlers: Handlers = {
        sendDigests: async () => ({
            status: 200,
            body: {
                sent: 1,
            },
        }),
        reconcile: ({ input }) => ({
            status: 200,
            body: {
                reconciled: input.since.length,
            },
        }),
        cleanup: ({ throwError }) => {
            if (Math.random() > 1) {
                throwError({
                    status: 503,
                    body: {
                        detail: 'Provider is down',
                    },
                });
            }
            return {
                status: 204,
                body: undefined,
            };
        },
    };
    expectTypeOf(handlers).toExtend<Handlers>();
});
