import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { UrlSchema } from './url.js';
import { parseJsonWithPlan, reviveBody, serializeBody, wirePlanFor } from './wire-plan.js';

describe('wirePlanFor', () => {
    it('returns null for schemas with nothing to convert', () => {
        expect(wirePlanFor(z.object({ name: z.string(), age: z.number() }), 'json', 'input')).toBeNull();
        expect(wirePlanFor(z.string(), 'json', 'input')).toBeNull();
    });

    it('plans nested dates, bigints, and urls', () => {
        const schema = z.object({
            createdAt: z.date(),
            counters: z.array(z.bigint()),
            profile: z.object({
                website: UrlSchema,
            }),
        });
        expect(wirePlanFor(schema, 'json', 'input')).not.toBeNull();
    });

    it('caches plans per schema', () => {
        const schema = z.object({
            createdAt: z.date(),
        });
        expect(wirePlanFor(schema, 'json', 'input')).toBe(wirePlanFor(schema, 'json', 'input'));
    });

    it('plans the input side of a pipe for requests and the output side for responses', () => {
        const schema = z.object({
            when: z.date().transform((date) => date.toISOString()),
        });
        expect(wirePlanFor(schema, 'json', 'input')).not.toBeNull();
        expect(wirePlanFor(schema, 'json', 'output')).toBeNull();
    });

    it('coerces plain scalars only in the form dialect', () => {
        const schema = z.object({
            age: z.number(),
            active: z.boolean(),
        });
        expect(wirePlanFor(schema, 'json', 'input')).toBeNull();
        expect(wirePlanFor(schema, 'form', 'input')).not.toBeNull();
    });
});

describe('reviveBody', () => {
    it('revives dates, bigints, and urls in a json body', () => {
        const schema = z.object({
            createdAt: z.date(),
            total: z.bigint(),
            website: UrlSchema,
        });
        const plan = wirePlanFor(schema, 'json', 'input');
        const revived = reviveBody(
            {
                createdAt: '2026-08-23T10:00:00.000Z',
                total: 42,
                website: 'https://example.com/docs',
            },
            plan
        ) as Record<string, unknown>;
        expect(revived.createdAt).toBeInstanceOf(Date);
        expect(revived.total).toBe(42n);
        expect(revived.website).toBeInstanceOf(URL);
    });

    it('revives nested objects, arrays, records, and optionals', () => {
        const schema = z.object({
            events: z.array(
                z.object({
                    at: z.date(),
                })
            ),
            byName: z.record(z.string(), z.date()),
            deletedAt: z.date().optional(),
        });
        const plan = wirePlanFor(schema, 'json', 'input');
        const revived = reviveBody(
            {
                events: [
                    {
                        at: '2026-08-23T10:00:00.000Z',
                    },
                ],
                byName: {
                    first: '2026-01-01T00:00:00.000Z',
                },
            },
            plan
        ) as {
            events: Array<{ at: unknown }>;
            byName: Record<string, unknown>;
        };
        expect(revived.events[0]?.at).toBeInstanceOf(Date);
        expect(revived.byName.first).toBeInstanceOf(Date);
    });

    it('revives the matching variant of a discriminated union', () => {
        const schema = z.discriminatedUnion('kind', [
            z.object({
                kind: z.literal('scheduled'),
                at: z.date(),
            }),
            z.object({
                kind: z.literal('immediate'),
            }),
        ]);
        const plan = wirePlanFor(schema, 'json', 'input');
        const revived = reviveBody(
            {
                kind: 'scheduled',
                at: '2026-08-23T10:00:00.000Z',
            },
            plan
        ) as Record<string, unknown>;
        expect(revived.at).toBeInstanceOf(Date);
    });

    it('leaves values that do not match the plan untouched', () => {
        const schema = z.object({
            createdAt: z.date(),
            website: UrlSchema,
        });
        const plan = wirePlanFor(schema, 'json', 'input');
        const input = {
            createdAt: 'not-a-date',
            website: 'not a url',
        };
        expect(reviveBody(input, plan)).toBe(input);
    });

    it('returns the input itself when nothing changes', () => {
        const schema = z.object({
            name: z.string(),
        });
        const input = {
            name: 'Ada',
        };
        expect(reviveBody(input, wirePlanFor(schema, 'json', 'input'))).toBe(input);
    });

    it('coerces form strings to numbers, booleans, bigints, and dates', () => {
        const schema = z.object({
            age: z.number(),
            active: z.boolean(),
            total: z.bigint(),
            at: z.date(),
        });
        const plan = wirePlanFor(schema, 'form', 'input');
        expect(
            reviveBody(
                {
                    age: '30',
                    active: 'true',
                    total: '9007199254740993',
                    at: '2026-08-23T10:00:00.000Z',
                },
                plan
            )
        ).toEqual({
            age: 30,
            active: true,
            total: 9007199254740993n,
            at: new Date('2026-08-23T10:00:00.000Z'),
        });
    });
});

describe('serializeBody', () => {
    it('serializes dates to ISO strings and urls to hrefs', () => {
        const schema = z.object({
            createdAt: z.date(),
            website: UrlSchema,
        });
        const plan = wirePlanFor(schema, 'json', 'output');
        expect(
            serializeBody(
                {
                    createdAt: new Date('2026-08-23T10:00:00.000Z'),
                    website: new URL('https://example.com/docs'),
                },
                plan
            )
        ).toEqual({
            createdAt: '2026-08-23T10:00:00.000Z',
            website: 'https://example.com/docs',
        });
    });

    it('serializes bigints so JSON.stringify emits exact integers', () => {
        const schema = z.object({
            total: z.bigint(),
        });
        const plan = wirePlanFor(schema, 'json', 'output');
        const serialized = serializeBody(
            {
                total: 9007199254740993n,
            },
            plan
        );
        expect(JSON.stringify(serialized)).toBe('{"total":9007199254740993}');
    });

    it('returns the input itself when nothing changes', () => {
        const schema = z.object({
            name: z.string(),
        });
        const input = {
            name: 'Ada',
        };
        expect(serializeBody(input, wirePlanFor(schema, 'json', 'output'))).toBe(input);
    });
});

describe('parseJsonWithPlan', () => {
    it('parses and revives a json body', () => {
        const schema = z.object({
            createdAt: z.date(),
        });
        const plan = wirePlanFor(schema, 'json', 'output');
        const parsed = parseJsonWithPlan('{"createdAt":"2026-08-23T10:00:00.000Z"}', plan) as Record<string, unknown>;
        expect(parsed.createdAt).toBeInstanceOf(Date);
    });

    it('preserves bigints beyond Number.MAX_SAFE_INTEGER exactly', () => {
        const schema = z.object({
            total: z.bigint(),
        });
        const plan = wirePlanFor(schema, 'json', 'output');
        expect(parseJsonWithPlan('{"total":9007199254740993}', plan)).toEqual({
            total: 9007199254740993n,
        });
    });

    it('returns stray large integers outside bigint fields as numbers', () => {
        const schema = z.object({
            total: z.bigint(),
        });
        const plan = wirePlanFor(schema, 'json', 'output');
        const parsed = parseJsonWithPlan('{"total":1,"unknown":9007199254740993}', plan) as Record<string, unknown>;
        expect(parsed.total).toBe(1n);
        expect(typeof parsed.unknown).toBe('number');
    });
});
