/**
 * A job's schedule: a five-field cron expression, or that expression together
 * with the IANA time zone its fields are read in.
 */
export type JobSchedule =
    | string
    | {
          cron: string;
          /**
           * IANA time zone name, e.g. `'Europe/Oslo'`. Omitted means UTC.
           */
          timezone?: string;
      };

/**
 * The cron expression of a {@link JobSchedule}, whichever form it was written in.
 */
export const scheduleExpression = (schedule: JobSchedule): string => (typeof schedule === 'string' ? schedule : schedule.cron);

/**
 * The time zone of a {@link JobSchedule}, or `undefined` for UTC.
 */
export const scheduleTimezone = (schedule: JobSchedule): string | undefined =>
    typeof schedule === 'string' ? undefined : schedule.timezone;

const MONTH_NAMES: Readonly<Record<string, number>> = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
};

const DAY_NAMES: Readonly<Record<string, number>> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
};

interface FieldSpec {
    readonly label: string;
    readonly min: number;
    readonly max: number;
    readonly names?: Readonly<Record<string, number>>;
}

const FIELD_SPECS: readonly FieldSpec[] = [
    {
        label: 'minute',
        min: 0,
        max: 59,
    },
    {
        label: 'hour',
        min: 0,
        max: 23,
    },
    {
        label: 'day of month',
        min: 1,
        max: 31,
    },
    {
        label: 'month',
        min: 1,
        max: 12,
        names: MONTH_NAMES,
    },
    {
        label: 'day of week',
        min: 0,
        max: 7,
        names: DAY_NAMES,
    },
];

/**
 * A cron expression resolved to the set of values each field permits.
 */
export interface ParsedCron {
    minutes: ReadonlySet<number>;
    hours: ReadonlySet<number>;
    daysOfMonth: ReadonlySet<number>;
    months: ReadonlySet<number>;
    daysOfWeek: ReadonlySet<number>;
    /**
     * Whether the day-of-month field was narrowed from `*`. When both day fields
     * are narrowed, a run happens on a day matching *either* of them — the Vixie
     * cron rule.
     */
    dayOfMonthRestricted: boolean;
    /**
     * Whether the day-of-week field was narrowed from `*`. See
     * {@link ParsedCron.dayOfMonthRestricted}.
     */
    dayOfWeekRestricted: boolean;
    timezone: string | undefined;
}

const fail = (expression: string, reason: string): never => {
    throw new Error(`Invalid cron expression "${expression}": ${reason}.`);
};

const readFieldValue = (token: string, spec: FieldSpec, expression: string): number => {
    const named = spec.names?.[token.toLowerCase()];
    const value = named ?? (/^\d+$/.test(token) ? Number(token) : undefined);
    if (value === undefined) {
        const allowed = spec.names ? ` or one of ${Object.keys(spec.names).join(', ')}` : '';
        return fail(expression, `the ${spec.label} field has "${token}", which is not a number${allowed}`);
    }
    if (value < spec.min || value > spec.max) {
        return fail(expression, `the ${spec.label} field has ${value}, outside the allowed ${spec.min}-${spec.max}`);
    }
    return value;
};

/**
 * Day of week accepts both 0 and 7 for Sunday, per crontab(5).
 */
const normalizeValue = (value: number, spec: FieldSpec): number => (spec.label === 'day of week' && value === 7 ? 0 : value);

const parseField = (raw: string, spec: FieldSpec, expression: string): Set<number> => {
    const values = new Set<number>();
    for (const part of raw.split(',')) {
        if (part === '') fail(expression, `the ${spec.label} field has an empty entry`);
        const [rangeToken, stepToken, ...extra] = part.split('/');
        if (extra.length > 0) fail(expression, `the ${spec.label} field entry "${part}" has more than one step`);
        let step = 1;
        if (stepToken !== undefined) {
            if (!/^\d+$/.test(stepToken) || Number(stepToken) < 1) {
                fail(expression, `the ${spec.label} field entry "${part}" has step "${stepToken}", which must be a positive number`);
            }
            step = Number(stepToken);
        }
        let start: number;
        let end: number;
        if (rangeToken === '*') {
            start = spec.min;
            end = spec.max;
        } else {
            const bounds = rangeToken!.split('-');
            if (bounds.length === 1) {
                start = readFieldValue(bounds[0]!, spec, expression);
                // A bare value with a step runs from that value to the end of the field.
                end = stepToken === undefined ? start : spec.max;
            } else if (bounds.length === 2) {
                start = readFieldValue(bounds[0]!, spec, expression);
                end = readFieldValue(bounds[1]!, spec, expression);
            } else {
                return fail(expression, `the ${spec.label} field entry "${part}" is not a valid range`);
            }
        }
        if (start > end) {
            fail(expression, `the ${spec.label} field entry "${part}" has a range that ends before it starts`);
        }
        for (let value = start; value <= end; value += step) {
            values.add(normalizeValue(value, spec));
        }
    }
    return values;
};

/**
 * Parse a five-field cron expression into the values each field permits.
 * Throws with the offending field named.
 *
 * @example
 * parseCron('0 5 * * *').hours; // Set { 5 }
 */
export const parseCron = (schedule: JobSchedule): ParsedCron => {
    const expression = scheduleExpression(schedule);
    const fields = expression.trim().split(/\s+/);
    if (expression.trim() === '') fail(expression, 'it is empty');
    if (fields.length !== 5) {
        fail(
            expression,
            `it has ${fields.length} field${fields.length === 1 ? '' : 's'}, but a cron expression has 5 ` +
                `(minute hour day-of-month month day-of-week)`
        );
    }
    const [minute, hour, dayOfMonth, month, dayOfWeek] = fields as [string, string, string, string, string];
    return {
        minutes: parseField(minute, FIELD_SPECS[0]!, expression),
        hours: parseField(hour, FIELD_SPECS[1]!, expression),
        daysOfMonth: parseField(dayOfMonth, FIELD_SPECS[2]!, expression),
        months: parseField(month, FIELD_SPECS[3]!, expression),
        daysOfWeek: parseField(dayOfWeek, FIELD_SPECS[4]!, expression),
        dayOfMonthRestricted: dayOfMonth !== '*',
        dayOfWeekRestricted: dayOfWeek !== '*',
        timezone: scheduleTimezone(schedule),
    };
};

/**
 * Throws when a job's schedule is not a valid cron expression, naming the job.
 * Called by `k.jobs` so a bad schedule fails when the contract is built rather
 * than when the scheduler first fires.
 */
export const assertValidSchedule = (schedule: JobSchedule, jobName: string): void => {
    try {
        parseCron(schedule);
    } catch (error) {
        throw new Error(`Job "${jobName}" has an invalid schedule. ${error instanceof Error ? error.message : String(error)}`);
    }
    const timezone = scheduleTimezone(schedule);
    if (timezone === undefined) return;
    try {
        new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
        });
    } catch {
        throw new Error(`Job "${jobName}" has an unknown time zone "${timezone}". Use an IANA name such as 'Europe/Oslo'.`);
    }
};

/**
 * Wall-clock fields, held as the epoch milliseconds they would be if read as
 * UTC. Calendar arithmetic on a schedule's own fields happens here, free of any
 * time zone; only {@link wallClockToInstant} brings a zone back in.
 */
type WallClock = number;

const MINUTE_MS = 60_000;

const partsFormatter = (timezone: string): Intl.DateTimeFormat =>
    new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });

const instantToWallClock = (instant: Date, timezone: string | undefined): WallClock => {
    if (timezone === undefined) {
        return Date.UTC(
            instant.getUTCFullYear(),
            instant.getUTCMonth(),
            instant.getUTCDate(),
            instant.getUTCHours(),
            instant.getUTCMinutes()
        );
    }
    const parts = new Map(
        partsFormatter(timezone)
            .formatToParts(instant)
            .map((part) => [part.type, part.value])
    );
    const hour = Number(parts.get('hour'));
    return Date.UTC(
        Number(parts.get('year')),
        Number(parts.get('month')) - 1,
        Number(parts.get('day')),
        // Intl renders midnight as 24 in some ICU versions.
        hour === 24 ? 0 : hour,
        Number(parts.get('minute'))
    );
};

const zoneOffsetAt = (instant: number, timezone: string): number => instantToWallClock(new Date(instant), timezone) - instant;

/**
 * Turn wall-clock fields back into the instant they name in `timezone`.
 *
 * A wall time can be ambiguous (clocks going back) or non-existent (clocks going
 * forward). The offset is sampled at a first guess and then re-sampled once at
 * the corrected instant, which resolves an overlap to the first of the two
 * candidates and pushes a gap to just after it — the same choice cron
 * implementations make.
 */
const wallClockToInstant = (wall: WallClock, timezone: string | undefined): Date => {
    if (timezone === undefined) return new Date(wall);
    const firstOffset = zoneOffsetAt(wall, timezone);
    const candidate = wall - firstOffset;
    const secondOffset = zoneOffsetAt(candidate, timezone);
    return new Date(secondOffset === firstOffset ? candidate : wall - secondOffset);
};

const dayMatches = (wall: WallClock, cron: ParsedCron): boolean => {
    const date = new Date(wall);
    const dayOfMonthMatches = cron.daysOfMonth.has(date.getUTCDate());
    const dayOfWeekMatches = cron.daysOfWeek.has(date.getUTCDay());
    // crontab(5): with both day fields narrowed, either one matching is enough.
    if (cron.dayOfMonthRestricted && cron.dayOfWeekRestricted) return dayOfMonthMatches || dayOfWeekMatches;
    if (cron.dayOfMonthRestricted) return dayOfMonthMatches;
    if (cron.dayOfWeekRestricted) return dayOfWeekMatches;
    return true;
};

const startOfNextMonth = (wall: WallClock): WallClock => {
    const date = new Date(wall);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 0, 0);
};

const startOfNextDay = (wall: WallClock): WallClock => {
    const date = new Date(wall);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 0, 0);
};

const startOfNextHour = (wall: WallClock): WallClock => {
    const date = new Date(wall);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours() + 1, 0);
};

/**
 * A cron expression can name a date that never occurs — `0 0 30 2 *`, February
 * 30th. Searching forever would hang, so the walk gives up once it has looked
 * five years ahead, which covers every reachable leap-year combination.
 */
const SEARCH_HORIZON_MS = 5 * 366 * 24 * 60 * MINUTE_MS;

/**
 * The first time at or after `from` that `schedule` fires, exclusive of `from`
 * itself. Returns `undefined` for a schedule that names a date which never
 * occurs, such as February 30th.
 *
 * @example
 * nextRun('0 5 * * *', new Date('2026-08-05T06:00:00Z'));
 * // 2026-08-06T05:00:00Z
 */
export const nextRun = (schedule: JobSchedule, from: Date = new Date()): Date | undefined => {
    const cron = parseCron(schedule);
    const start = instantToWallClock(from, cron.timezone);
    let wall = start + MINUTE_MS;
    while (wall - start < SEARCH_HORIZON_MS) {
        const date = new Date(wall);
        if (!cron.months.has(date.getUTCMonth() + 1)) {
            wall = startOfNextMonth(wall);
            continue;
        }
        if (!dayMatches(wall, cron)) {
            wall = startOfNextDay(wall);
            continue;
        }
        if (!cron.hours.has(date.getUTCHours())) {
            wall = startOfNextHour(wall);
            continue;
        }
        if (!cron.minutes.has(date.getUTCMinutes())) {
            wall += MINUTE_MS;
            continue;
        }
        return wallClockToInstant(wall, cron.timezone);
    }
    return undefined;
};

/**
 * The next `count` times a schedule fires after `from`. Stops early when the
 * schedule names a date that never occurs.
 */
export const nextRuns = (schedule: JobSchedule, count: number, from: Date = new Date()): Date[] => {
    const runs: Date[] = [];
    let cursor = from;
    for (let step = 0; step < count; step += 1) {
        const next = nextRun(schedule, cursor);
        if (next === undefined) break;
        runs.push(next);
        cursor = next;
    }
    return runs;
};

/**
 * Whether a schedule fires in the half-open window `(after, at]`.
 */
export const firesBetween = (schedule: JobSchedule, after: Date, at: Date): boolean => {
    const next = nextRun(schedule, after);
    return next !== undefined && next.getTime() <= at.getTime();
};

const DEFAULT_DISPATCH_WINDOW_MS = 60_000;

/**
 * The schedules due as of `at`, keyed as they were passed in.
 *
 * @example
 * const due = dueSchedules(
 *     Object.fromEntries(Object.entries(contract.jobs ?? {}).map(([name, job]) => [name, job.schedule]))
 * );
 */
export const dueSchedules = (
    schedules: Record<string, JobSchedule>,
    options?: {
        at?: Date;
        /**
         * How far back a tick looks. Widen it when the platform's delivery is
         * less punctual than its cron expression suggests.
         *
         * @default 60000
         */
        windowMs?: number;
    }
): string[] => {
    const at = options?.at ?? new Date();
    const after = new Date(at.getTime() - (options?.windowMs ?? DEFAULT_DISPATCH_WINDOW_MS));
    return Object.entries(schedules)
        .filter(([, schedule]) => firesBetween(schedule, after, at))
        .map(([name]) => name);
};

const readTimeOfDay = (time: string, caller: string): { hour: number; minute: number } => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(time);
    if (!match) {
        throw new Error(`${caller}() expects a 24-hour "HH:MM" time, but got "${time}".`);
    }
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) {
        throw new Error(`${caller}() got the time "${time}", which is not a real 24-hour time.`);
    }
    return {
        hour,
        minute,
    };
};

/**
 * A cron expression for a fixed interval, written as a duration: `'15m'` for
 * every fifteen minutes, `'2h'` for every two hours.
 *
 * Cron's finest granularity is one minute, so seconds are rejected. An interval
 * that does not divide its unit evenly is still valid cron, but it restarts at
 * the top of the unit rather than spacing evenly across the boundary — `'7h'`
 * fires at 00:00, 07:00, 14:00, 21:00, then 00:00 again.
 *
 * @example
 * every('15m'); // '*\/15 * * * *'
 */
const every = (interval: string): string => {
    const match = /^(\d+)(m|h)$/.exec(interval);
    if (!match) {
        throw new Error(
            `every() expects an interval like '15m' or '2h', but got "${interval}". Cron cannot fire more often than once a minute.`
        );
    }
    const amount = Number(match[1]);
    const unit = match[2];
    if (amount < 1) {
        throw new Error(`every() got the interval "${interval}", which must be at least 1.`);
    }
    if (unit === 'm') {
        if (amount > 59) {
            throw new Error(`every() got "${interval}"; an interval in minutes must be under 60. Use hours instead, e.g. '1h'.`);
        }
        return amount === 1 ? '* * * * *' : `*/${amount} * * * *`;
    }
    if (amount > 23) {
        throw new Error(`every() got "${interval}"; an interval in hours must be under 24. Use daily() instead.`);
    }
    return amount === 1 ? '0 * * * *' : `0 */${amount} * * *`;
};

/**
 * A cron expression for once an hour, at `minute` past.
 *
 * @example
 * hourly(30); // '30 * * * *'
 */
const hourly = (minute = 0): string => {
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
        throw new Error(`hourly() expects a minute between 0 and 59, but got ${minute}.`);
    }
    return `${minute} * * * *`;
};

/**
 * A cron expression for once a day, at a 24-hour `HH:MM` time.
 *
 * @example
 * daily('05:00'); // '0 5 * * *'
 */
const daily = (time: string): string => {
    const { hour, minute } = readTimeOfDay(time, 'daily');
    return `${minute} ${hour} * * *`;
};

/**
 * A cron expression for once a week, on a named day at a 24-hour `HH:MM` time.
 *
 * @example
 * weekly('mon', '05:00'); // '0 5 * * 1'
 */
const weekly = (day: keyof typeof DAY_NAMES, time: string): string => {
    const dayNumber = DAY_NAMES[day];
    if (dayNumber === undefined) {
        throw new Error(`weekly() expects one of ${Object.keys(DAY_NAMES).join(', ')}, but got "${day}".`);
    }
    const { hour, minute } = readTimeOfDay(time, 'weekly');
    return `${minute} ${hour} * * ${dayNumber}`;
};

/**
 * A cron expression for once a month, on `dayOfMonth` at a 24-hour `HH:MM` time.
 *
 * Days 29 to 31 are accepted but skip the months that are too short — a job on
 * the 31st fires seven times a year, not twelve.
 *
 * @example
 * monthly(1, '05:00'); // '0 5 1 * *'
 */
const monthly = (dayOfMonth: number, time: string): string => {
    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
        throw new Error(`monthly() expects a day of month between 1 and 31, but got ${dayOfMonth}.`);
    }
    const { hour, minute } = readTimeOfDay(time, 'monthly');
    return `${minute} ${hour} ${dayOfMonth} * *`;
};

/**
 * Builders for a five-field cron expression, for a `schedule` you would rather
 * read than decode. Each returns a plain cron string.
 *
 * @example
 * schedule: cron.daily('05:00');
 */
export const cron = {
    every,
    hourly,
    daily,
    weekly,
    monthly,
};
