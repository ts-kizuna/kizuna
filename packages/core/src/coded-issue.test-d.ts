import { expectTypeOf, test } from 'vitest';
import type { ValidationIssueCode } from './validation-error.js';
import type { CodedIssue } from './coded-issue.js';

test('ValidationIssueCode accepts built-in codes and arbitrary strings', () => {
    expectTypeOf<'invalid_type'>().toMatchTypeOf<ValidationIssueCode>();
    expectTypeOf<'custom'>().toMatchTypeOf<ValidationIssueCode>();
    expectTypeOf<'invalid_phone_number'>().toMatchTypeOf<ValidationIssueCode>();
});

test('ValidationIssueCode preserves literal suggestions (is not a bare string)', () => {
    // A bare `string` would equal `string`; the literal-union form does not,
    // which is what keeps editor autocomplete for the built-in codes.
    expectTypeOf<ValidationIssueCode>().not.toEqualTypeOf<string>();
});

test('CodedIssue.code is a ValidationIssueCode', () => {
    expectTypeOf<CodedIssue<string>['code']>().toEqualTypeOf<ValidationIssueCode>();
});
