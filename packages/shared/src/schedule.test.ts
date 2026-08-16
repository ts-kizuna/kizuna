import { describe, expect, test } from 'vitest';
import { assertValidSchedule, cron, nextRun, nextRuns, parseCron } from './schedule.js';

const at = (iso: string): Date => new Date(iso);
const iso = (date: Date | undefined): string | undefined => date?.toISOString();

describe('parseCron', () => {
    test('reads every field', () => {
        const cron = parseCron('5 4 3 2 1');
        expect([...cron.minutes]).toEqual([5]);
        expect([...cron.hours]).toEqual([4]);
        expect([...cron.daysOfMonth]).toEqual([3]);
        expect([...cron.months]).toEqual([2]);
        expect([...cron.daysOfWeek]).toEqual([1]);
    });

    test('expands wildcards to the full field range', () => {
        const cron = parseCron('* * * * *');
        expect(cron.minutes.size).toBe(60);
        expect(cron.hours.size).toBe(24);
        expect(cron.daysOfMonth.size).toBe(31);
        expect(cron.months.size).toBe(12);
        expect(cron.daysOfWeek.size).toBe(7);
    });

    test('expands steps, ranges, and lists', () => {
        expect([...parseCron('*/15 * * * *').minutes]).toEqual([0, 15, 30, 45]);
        expect([...parseCron('0 9-17 * * *').hours]).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
        expect([...parseCron('0 0,6,12,18 * * *').hours]).toEqual([0, 6, 12, 18]);
        expect([...parseCron('0 8-18/4 * * *').hours]).toEqual([8, 12, 16]);
    });

    test('a bare value with a step runs to the end of the field', () => {
        expect([...parseCron('5/15 * * * *').minutes]).toEqual([5, 20, 35, 50]);
    });

    test('accepts month and day names, case-insensitively', () => {
        expect([...parseCron('0 0 * JAN *').months]).toEqual([1]);
        expect([...parseCron('0 0 * jan-mar *').months]).toEqual([1, 2, 3]);
        expect([...parseCron('0 0 * * mon-fri').daysOfWeek]).toEqual([1, 2, 3, 4, 5]);
    });

    test('treats day-of-week 7 as Sunday', () => {
        expect([...parseCron('0 0 * * 7').daysOfWeek]).toEqual([0]);
    });

    test('tracks which day fields were narrowed', () => {
        expect(parseCron('0 0 * * *')).toMatchObject({
            dayOfMonthRestricted: false,
            dayOfWeekRestricted: false,
        });
        expect(parseCron('0 0 1 * mon')).toMatchObject({
            dayOfMonthRestricted: true,
            dayOfWeekRestricted: true,
        });
        expect(parseCron('0 0 */2 * *').dayOfMonthRestricted).toBe(true);
    });

    test('carries the time zone from the object form', () => {
        expect(parseCron({ cron: '0 5 * * *', timezone: 'Europe/Oslo' }).timezone).toBe('Europe/Oslo');
        expect(parseCron('0 5 * * *').timezone).toBeUndefined();
    });

    test.each([
        ['', 'it is empty'],
        ['* * * *', 'has 4 fields'],
        ['* * * * * *', 'has 6 fields'],
        ['60 * * * *', 'minute field has 60'],
        ['* 24 * * *', 'hour field has 24'],
        ['* * 0 * *', 'day of month field has 0'],
        ['* * * 13 *', 'month field has 13'],
        ['* * * * 8', 'day of week field has 8'],
        ['banana * * * *', 'minute field has "banana"'],
        ['* * * nope *', 'month field has "nope"'],
        ['*/0 * * * *', 'must be a positive number'],
        ['10-5 * * * *', 'ends before it starts'],
        ['1,,2 * * * *', 'empty entry'],
        ['1/2/3 * * * *', 'more than one step'],
        ['1-2-3 * * * *', 'not a valid range'],
    ])('rejects %j', (expression, reason) => {
        expect(() => parseCron(expression)).toThrow(reason);
    });
});

describe('assertValidSchedule', () => {
    test('names the job in the error', () => {
        expect(() => assertValidSchedule('nope', 'sendDigests')).toThrow('Job "sendDigests" has an invalid schedule');
    });

    test('rejects an unknown time zone', () => {
        expect(() => assertValidSchedule({ cron: '0 5 * * *', timezone: 'Mars/Olympus' }, 'sendDigests')).toThrow(
            'unknown time zone "Mars/Olympus"'
        );
    });

    test('accepts a valid schedule', () => {
        expect(() => assertValidSchedule({ cron: '0 5 * * *', timezone: 'Europe/Oslo' }, 'sendDigests')).not.toThrow();
    });
});

describe('nextRun', () => {
    test('is exclusive of the time passed in', () => {
        expect(iso(nextRun('0 5 * * *', at('2026-08-05T05:00:00Z')))).toBe('2026-08-06T05:00:00.000Z');
    });

    test('finds the same day when the time is still ahead', () => {
        expect(iso(nextRun('0 5 * * *', at('2026-08-05T04:59:00Z')))).toBe('2026-08-05T05:00:00.000Z');
    });

    test('drops seconds and milliseconds', () => {
        expect(iso(nextRun('* * * * *', at('2026-08-05T04:59:30.500Z')))).toBe('2026-08-05T05:00:00.000Z');
    });

    test('walks a step expression', () => {
        expect(nextRuns('*/15 * * * *', 4, at('2026-08-05T05:00:00Z')).map(iso)).toEqual([
            '2026-08-05T05:15:00.000Z',
            '2026-08-05T05:30:00.000Z',
            '2026-08-05T05:45:00.000Z',
            '2026-08-05T06:00:00.000Z',
        ]);
    });

    test('crosses a month boundary', () => {
        expect(iso(nextRun('0 0 1 * *', at('2026-08-05T00:00:00Z')))).toBe('2026-09-01T00:00:00.000Z');
    });

    test('crosses a year boundary', () => {
        expect(iso(nextRun('0 0 1 1 *', at('2026-08-05T00:00:00Z')))).toBe('2027-01-01T00:00:00.000Z');
    });

    test('skips months too short for the day', () => {
        expect(nextRuns('0 0 31 * *', 3, at('2026-01-31T00:00:00Z')).map(iso)).toEqual([
            '2026-03-31T00:00:00.000Z',
            '2026-05-31T00:00:00.000Z',
            '2026-07-31T00:00:00.000Z',
        ]);
    });

    test('finds February 29th only in a leap year', () => {
        expect(iso(nextRun('0 0 29 2 *', at('2026-03-01T00:00:00Z')))).toBe('2028-02-29T00:00:00.000Z');
    });

    test('returns undefined for a date that never occurs', () => {
        expect(nextRun('0 0 30 2 *', at('2026-08-05T00:00:00Z'))).toBeUndefined();
    });

    test('matches either day field when both are narrowed', () => {
        // The 1st of the month, or any Monday.
        const runs = nextRuns('0 0 1 * mon', 4, at('2026-08-30T00:00:00Z')).map(iso);
        expect(runs).toEqual([
            '2026-08-31T00:00:00.000Z', // Monday
            '2026-09-01T00:00:00.000Z', // the 1st
            '2026-09-07T00:00:00.000Z', // Monday
            '2026-09-14T00:00:00.000Z', // Monday
        ]);
    });

    test('honours a weekday-only schedule', () => {
        // 2026-08-07 is a Friday.
        expect(nextRuns('0 9 * * mon-fri', 3, at('2026-08-07T09:00:00Z')).map(iso)).toEqual([
            '2026-08-10T09:00:00.000Z',
            '2026-08-11T09:00:00.000Z',
            '2026-08-12T09:00:00.000Z',
        ]);
    });

    describe('time zones', () => {
        test('reads the schedule in the given zone', () => {
            // Oslo is UTC+2 in August.
            expect(iso(nextRun({ cron: '0 5 * * *', timezone: 'Europe/Oslo' }, at('2026-08-05T00:00:00Z')))).toBe(
                '2026-08-05T03:00:00.000Z'
            );
        });

        test('tracks the offset across a winter boundary', () => {
            // Oslo is UTC+1 in January.
            expect(iso(nextRun({ cron: '0 5 * * *', timezone: 'Europe/Oslo' }, at('2026-01-05T00:00:00Z')))).toBe(
                '2026-01-05T04:00:00.000Z'
            );
        });

        test('keeps the wall-clock hour across spring forward', () => {
            // Oslo springs forward 2026-03-29 02:00 -> 03:00.
            const runs = nextRuns({ cron: '0 5 * * *', timezone: 'Europe/Oslo' }, 2, at('2026-03-27T12:00:00Z')).map(iso);
            expect(runs).toEqual([
                '2026-03-28T04:00:00.000Z', // 05:00 at UTC+1
                '2026-03-29T03:00:00.000Z', // 05:00 at UTC+2
            ]);
        });

        test('keeps the wall-clock hour across autumn back', () => {
            // Oslo falls back 2026-10-25 03:00 -> 02:00.
            const runs = nextRuns({ cron: '0 5 * * *', timezone: 'Europe/Oslo' }, 2, at('2026-10-23T12:00:00Z')).map(iso);
            expect(runs).toEqual([
                '2026-10-24T03:00:00.000Z', // 05:00 at UTC+2
                '2026-10-25T04:00:00.000Z', // 05:00 at UTC+1
            ]);
        });

        test('resolves a wall time inside a spring-forward gap', () => {
            // 02:30 does not exist in Oslo on 2026-03-29.
            expect(iso(nextRun({ cron: '30 2 * * *', timezone: 'Europe/Oslo' }, at('2026-03-28T12:00:00Z')))).toBe(
                '2026-03-29T01:30:00.000Z'
            );
        });

        test('handles a zone west of UTC', () => {
            expect(iso(nextRun({ cron: '0 5 * * *', timezone: 'America/New_York' }, at('2026-08-05T00:00:00Z')))).toBe(
                '2026-08-05T09:00:00.000Z'
            );
        });
    });
});

describe('schedule helpers', () => {
    test('every', () => {
        expect(cron.every('1m')).toBe('* * * * *');
        expect(cron.every('15m')).toBe('*/15 * * * *');
        expect(cron.every('1h')).toBe('0 * * * *');
        expect(cron.every('2h')).toBe('0 */2 * * *');
    });

    test.each(['30s', '0m', '60m', '24h', '15', 'm', 'banana'])('every rejects %j', (interval) => {
        expect(() => cron.every(interval)).toThrow();
    });

    test('hourly', () => {
        expect(cron.hourly()).toBe('0 * * * *');
        expect(cron.hourly(30)).toBe('30 * * * *');
        expect(() => cron.hourly(60)).toThrow('between 0 and 59');
    });

    test('daily', () => {
        expect(cron.daily('05:00')).toBe('0 5 * * *');
        expect(cron.daily('23:45')).toBe('45 23 * * *');
        expect(() => cron.daily('24:00')).toThrow('not a real 24-hour time');
        expect(() => cron.daily('5pm')).toThrow('expects a 24-hour "HH:MM" time');
    });

    test('weekly', () => {
        expect(cron.weekly('mon', '05:00')).toBe('0 5 * * 1');
        expect(cron.weekly('sun', '00:00')).toBe('0 0 * * 0');
    });

    test('monthly', () => {
        expect(cron.monthly(1, '05:00')).toBe('0 5 1 * *');
        expect(() => cron.monthly(0, '05:00')).toThrow('between 1 and 31');
        expect(() => cron.monthly(32, '05:00')).toThrow('between 1 and 31');
    });

    test('helper output parses and runs', () => {
        expect(iso(nextRun(cron.daily('05:00'), at('2026-08-05T06:00:00Z')))).toBe('2026-08-06T05:00:00.000Z');
        expect(iso(nextRun(cron.weekly('mon', '09:00'), at('2026-08-07T00:00:00Z')))).toBe('2026-08-10T09:00:00.000Z');
    });
});
