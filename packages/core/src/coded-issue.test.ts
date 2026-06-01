import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { addCodedIssue } from './coded-issue.js';
import { renderJsonResult } from './adapter.js';

/**
 * Map Zod issues through the adapter's `validation-failed` rendering exactly as
 * a real 400 response would, then return the `errors` extension member.
 */
const renderErrors = (issues: z.core.$ZodIssue[]): Array<{ code: string; path: string[]; message: string }> => {
    const rendered = renderJsonResult({
        kind: 'validation-failed',
        stage: 'body',
        detail: 'Validation failed',
        issues,
    });
    return (rendered.body as { errors: Array<{ code: string; path: string[]; message: string }> }).errors;
};

describe('addCodedIssue', () => {
    it('surfaces a custom code in errors[].code with the field path', () => {
        const schema = z.object({
            phone: z.string().superRefine((value, ctx) => {
                if (value === 'valid') return;
                addCodedIssue(ctx, {
                    code: 'invalid_phone_number',
                    message: 'Invalid phone number',
                    input: value,
                });
            }),
        });

        const result = schema.safeParse({
            phone: 'nope',
        });
        expect(result.success).toBe(false);

        const errors = renderErrors(result.error!.issues);
        expect(errors).toEqual([
            {
                code: 'invalid_phone_number',
                path: ['phone'],
                message: 'Invalid phone number',
            },
        ]);
    });

    it('type-checks with a non-built-in code string and no cast at the call site', () => {
        const schema = z.string().superRefine((value, ctx) => {
            addCodedIssue(ctx, {
                code: 'totally_made_up_code',
                message: 'nope',
                input: value,
            });
        });
        expect(schema.safeParse('x').success).toBe(false);
    });
});

describe('validation-failed code mapping', () => {
    it('leaves built-in Zod issue codes unchanged', () => {
        const schema = z.object({
            name: z.string(),
            age: z.number().min(18),
        });

        const errors = renderErrors(schema.safeParse({ name: 123, age: 5 }).error!.issues);
        expect(errors).toEqual([
            {
                code: 'invalid_type',
                path: ['name'],
                message: expect.any(String),
            },
            {
                code: 'too_small',
                path: ['age'],
                message: expect.any(String),
            },
        ]);
    });
});
