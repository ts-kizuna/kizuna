import { z } from 'zod';
import type { BuiltinIssueCode, ValidationIssueCode } from './validation-error.js';

/**
 * A validation issue carrying a custom machine-readable {@link code}.
 *
 * The `code` may be any string. ts-kizuna surfaces it verbatim in the
 * `errors[].code` field of its RFC 9457 validation error response.
 */
export interface CodedIssue<Input> {
    /**
     * Machine-readable error classification (e.g. `invalid_phone_number`).
     *
     * Built-in Zod codes are suggested for autocomplete, but any custom string
     * is accepted.
     */
    code: ValidationIssueCode;
    /**
     * Human-readable description of the validation failure.
     */
    message: string;
    /**
     * The value that failed validation.
     */
    input: Input;
}

/**
 * A validation issue whose `code` is checked against the issue codes declared on
 * `new Kizuna()`, plus Zod's built-ins. This is what `k.issue` accepts.
 */
export interface RegisteredIssue<Codes extends string, Input> {
    /**
     * Machine-readable error classification, from `settings.validation.issueCodes` or
     * Zod's built-ins.
     */
    code: Codes | BuiltinIssueCode;
    /**
     * Human-readable description of the validation failure.
     */
    message: string;
    /**
     * The value that failed validation.
     */
    input: Input;
}

/**
 * Emit a single validation issue with a custom machine-readable `code`.
 *
 * Zod's runtime accepts any `code` string, but its types restrict
 * `ctx.addIssue()` to the built-in issue union, so a custom code fails to
 * type-check without a cast. This helper owns that cast in one place so call
 * sites stay cast-free.
 *
 * Application code uses `k.issue`, which narrows `code` to the declared codes.
 */
export function addCodedIssue<Input>(ctx: z.core.$RefinementCtx<Input>, issue: CodedIssue<Input>): void {
    ctx.addIssue(issue as unknown as Parameters<typeof ctx.addIssue>[0]);
}
