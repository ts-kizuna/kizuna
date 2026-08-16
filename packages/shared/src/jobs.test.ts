import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Kizuna } from './kizuna.js';
import { isCompiledJob, isJobDefinition } from './jobs.js';
import { cron } from './schedule.js';

const scheduler = Kizuna.identity.bearer({
    description: 'The platform scheduler',
});

const k = new Kizuna({
    identities: {
        scheduler,
    },
});

describe('k.jobs', () => {
    it('compiles a job, carrying its schedule and identity', () => {
        const jobs = k.jobs('scheduler', {
            sendDigests: {
                schedule: '0 5 * * *',
            },
        });
        expect(jobs.sendDigests.schedule).toBe('0 5 * * *');
        expect(jobs.sendDigests.identity).toBe('scheduler');
    });

    it('leaves the identity undefined when declared without one', () => {
        const jobs = k.jobs({
            sendDigests: {
                schedule: '0 5 * * *',
            },
        });
        expect(jobs.sendDigests.identity).toBeUndefined();
    });

    it('answers 204 when the job declares no result', () => {
        const jobs = k.jobs('scheduler', {
            sendDigests: {
                schedule: '0 5 * * *',
            },
        });
        expect(Object.keys(jobs.sendDigests.responses).sort()).toEqual(['204', '422', '500', '503']);
    });

    it('answers 200 with the result schema when declared', () => {
        const jobs = k.jobs('scheduler', {
            sendDigests: {
                schedule: '0 5 * * *',
                result: z.object({
                    sent: z.int(),
                }),
            },
        });
        expect(Object.keys(jobs.sendDigests.responses).sort()).toEqual(['200', '422', '500', '503']);
    });

    it('always synthesizes the retry contract statuses', () => {
        const jobs = k.jobs('scheduler', {
            sendDigests: {
                schedule: '0 5 * * *',
            },
        });
        const responses = jobs.sendDigests.responses as Record<number, unknown>;
        for (const status of [422, 500, 503]) {
            expect(responses[status]).toBeDefined();
        }
    });

    it('keeps the input schema for validation', () => {
        const input = z.object({
            since: z.iso.datetime(),
        });
        const jobs = k.jobs('scheduler', {
            sendDigests: {
                input,
            },
        });
        expect(jobs.sendDigests.input).toBe(input);
    });

    it('merges extra responses over the synthesized ones', () => {
        const conflict = z.object({
            type: z.string(),
            title: z.string(),
            status: z.number(),
            detail: z.string(),
            lockedBy: z.string(),
        });
        const jobs = k.jobs('scheduler', {
            sendDigests: {
                schedule: '0 5 * * *',
                responses: {
                    409: conflict,
                },
            },
        });
        expect((jobs.sendDigests.responses as Record<number, unknown>)[409]).toBe(conflict);
        expect((jobs.sendDigests.responses as Record<number, unknown>)[503]).toBeDefined();
    });

    it('accepts a schedule built by a helper', () => {
        const jobs = k.jobs('scheduler', {
            sendDigests: {
                schedule: cron.daily('05:00'),
            },
        });
        expect(jobs.sendDigests.schedule).toBe('0 5 * * *');
    });

    it('accepts the object schedule form', () => {
        const jobs = k.jobs('scheduler', {
            sendDigests: {
                schedule: {
                    cron: '0 5 * * *',
                    timezone: 'Europe/Oslo',
                },
            },
        });
        expect(jobs.sendDigests.schedule).toEqual({
            cron: '0 5 * * *',
            timezone: 'Europe/Oslo',
        });
    });

    it('nests groups of jobs', () => {
        const jobs = k.jobs('scheduler', {
            billing: {
                reconcileInvoices: {
                    schedule: '0 5 * * *',
                },
            },
        });
        expect(isCompiledJob(jobs.billing)).toBe(false);
        expect(jobs.billing.reconcileInvoices.schedule).toBe('0 5 * * *');
    });

    it('compiles a job declaring nothing at all', () => {
        const jobs = k.jobs('scheduler', {
            ping: {},
        });
        expect(jobs.ping.schedule).toBeUndefined();
        expect(Object.keys(jobs.ping.responses).sort()).toEqual(['204', '422', '500', '503']);
    });

    it('rejects an invalid schedule, naming the job', () => {
        expect(() =>
            k.jobs('scheduler', {
                sendDigests: {
                    schedule: 'every morning',
                },
            })
        ).toThrow('Job "sendDigests" has an invalid schedule');
    });

    it('names the nested job whose schedule is invalid', () => {
        expect(() =>
            k.jobs('scheduler', {
                billing: {
                    reconcileInvoices: {
                        schedule: 'every morning',
                    },
                },
            })
        ).toThrow('Job "billing.reconcileInvoices" has an invalid schedule');
    });

    it('rejects a scheduled job whose input will not accept an empty payload', () => {
        expect(() =>
            k.jobs('scheduler', {
                indexUser: {
                    schedule: '0 5 * * *',
                    input: z.object({
                        userId: z.string(),
                    }),
                },
            })
        ).toThrow('will not accept an empty payload');
    });

    it('rejects a retry that is not a whole number of attempts', () => {
        expect(() =>
            k.jobs('scheduler', {
                sendDigests: {
                    retry: 0,
                },
            })
        ).toThrow('at least 1');
    });

    it('rejects a node that is neither a job nor a group', () => {
        expect(() =>
            k.jobs('scheduler', {
                billing: {
                    reconcileInvoices: 'nightly' as unknown as Record<string, never>,
                },
            })
        ).toThrow('Job "billing.reconcileInvoices" is not an object');
    });
});

describe('isJobDefinition', () => {
    it('reads a node declaring only job fields as a job', () => {
        expect(
            isJobDefinition({
                schedule: '0 5 * * *',
                retry: 3,
            })
        ).toBe(true);
    });

    it('reads an empty node as a job', () => {
        expect(isJobDefinition({})).toBe(true);
    });

    it('reads a node holding other jobs as a group', () => {
        expect(
            isJobDefinition({
                reconcileInvoices: {
                    schedule: '0 5 * * *',
                },
            })
        ).toBe(false);
    });

    // A group is free to take a name a job field also uses, so the value's type
    // decides, not the key alone.
    it('reads a group named after a job field as a group', () => {
        expect(
            isJobDefinition({
                summary: {
                    schedule: '0 5 * * *',
                },
            })
        ).toBe(false);
    });
});

describe('isCompiledJob', () => {
    it('recognises a compiled job', () => {
        const jobs = k.jobs('scheduler', {
            sendDigests: {
                schedule: '0 5 * * *',
            },
        });
        expect(isCompiledJob(jobs.sendDigests)).toBe(true);
    });

    it.each([[null], [undefined], [{}], [{ responses: {} }]])('rejects %j', (value) => {
        expect(isCompiledJob(value)).toBe(false);
    });
});

describe('k.contract with jobs', () => {
    const routes = k.routes({
        listUsers: {
            method: 'GET',
            path: '/users',
            responses: {
                200: z.array(z.string()),
            },
        },
    });

    it('carries jobs alongside routes, not inside them', () => {
        const jobs = k.jobs('scheduler', {
            sendDigests: {
                schedule: '0 5 * * *',
            },
        });
        const contract = k.contract({
            routes,
            jobs,
            auth: {
                listUsers: false,
            },
        });
        expect(Object.keys(contract.jobs ?? {})).toEqual(['sendDigests']);
        expect(Object.keys(contract.routes)).toEqual(['listUsers']);
    });

    it('leaves jobs undefined when none are declared', () => {
        const contract = k.contract({
            routes,
            auth: {
                listUsers: false,
            },
        });
        expect(contract.jobs).toBeUndefined();
    });

    it('does not require jobs in the auth map', () => {
        const jobs = k.jobs('scheduler', {
            sendDigests: {
                schedule: '0 5 * * *',
            },
        });
        expect(() =>
            k.contract({
                routes,
                jobs,
                auth: {
                    listUsers: false,
                },
            })
        ).not.toThrow();
    });
});

describe('a job endpoint colliding with a route', () => {
    const routesAt = (path: `/${string}`) =>
        k.routes({
            listJobs: {
                method: 'POST',
                path,
                responses: {
                    200: z.array(z.string()),
                },
            },
        });

    const scheduled = k.jobs('scheduler', {
        sendDigests: {
            schedule: '0 5 * * *',
        },
    });

    it.each([['/jobs/dispatch'], ['/jobs/run']] as const)('rejects a contract whose route already serves %s', (path) => {
        expect(() =>
            k.contract({
                routes: routesAt(path),
                jobs: scheduled,
                auth: {
                    listJobs: false,
                },
            })
        ).toThrow('which already serves it');
    });

    it('leaves the namespace itself free', () => {
        expect(() =>
            k.contract({
                routes: routesAt('/jobs'),
                jobs: scheduled,
                auth: {
                    listJobs: false,
                },
            })
        ).not.toThrow();
    });

    it('accepts the same route once the endpoints are moved', () => {
        const moved = new Kizuna({
            identities: {
                scheduler,
            },
            jobs: {
                path: '/internal/tick',
            },
        });
        expect(() =>
            moved.contract({
                routes: moved.routes({
                    listJobs: {
                        method: 'POST',
                        path: '/jobs/dispatch',
                        responses: {
                            200: z.array(z.string()),
                        },
                    },
                }),
                jobs: moved.jobs('scheduler', {
                    sendDigests: {
                        schedule: '0 5 * * *',
                    },
                }),
                auth: {
                    listJobs: false,
                },
            })
        ).not.toThrow();
    });
});
