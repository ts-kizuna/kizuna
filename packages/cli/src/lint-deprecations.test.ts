import { afterAll, describe, expect, test } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { lintDeprecations } from './lint-deprecations.js';

const tempDirs: string[] = [];

const writeContract = (body: string, extra: Record<string, string> = {}): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kizuna-lint-'));
    tempDirs.push(dir);
    for (const [name, content] of Object.entries(extra)) fs.writeFileSync(path.join(dir, name), content, 'utf8');
    const entry = path.join(dir, 'contract.ts');
    fs.writeFileSync(entry, body, 'utf8');
    return entry;
};

afterAll(() => {
    for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('lintDeprecations', () => {
    test('flags a misspelled @deprecated tag', () => {
        const entry = writeContract(`import { z } from 'zod';
export const UserSchema = z.object({
    /**
     * @depricated use email_address
     */
    email: z.string(),
});
`);
        const warnings = lintDeprecations(entry);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]!.message).toContain('@depricated');
        expect(warnings[0]!.message).toContain('typo of `@deprecated`');
        expect(warnings[0]!.file).toBe(entry);
        expect(warnings[0]!.line).toBe(4);
    });

    test('flags a duplicate @deprecated in one comment', () => {
        const entry = writeContract(`export const route = {
    /**
     * @deprecated use newRoute
     * @deprecated really, use newRoute
     */
    method: 'GET',
};
`);
        const warnings = lintDeprecations(entry);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]!.message).toContain('Duplicate');
    });

    test('does not flag a correct @deprecated alongside other tags', () => {
        const entry = writeContract(`export const UserSchema = {
    /**
     * The email address.
     *
     * @deprecated use email_address
     * @example "a@b.com"
     * @see https://example.com
     */
    email: 'string',
};
`);
        expect(lintDeprecations(entry)).toEqual([]);
    });

    test('does not flag unrelated tags', () => {
        const entry = writeContract(`export const x = {
    /**
     * @param id the id
     * @returns the thing
     * @internal
     */
    foo: 1,
};
`);
        expect(lintDeprecations(entry)).toEqual([]);
    });

    test('follows relative imports', () => {
        const entry = writeContract(`import { schemas } from './schemas.js';\nexport const contract = schemas;\n`, {
            'schemas.ts': `export const schemas = {
    /**
     * @deprecate one
     */
    a: 1,
};
`,
        });
        const warnings = lintDeprecations(entry);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]!.file.endsWith('schemas.ts')).toBe(true);
        expect(warnings[0]!.message).toContain('@deprecate');
    });
});
