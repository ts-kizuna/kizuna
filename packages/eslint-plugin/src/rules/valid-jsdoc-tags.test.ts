import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { validJsDocTags } from './valid-jsdoc-tags.js';
import { nearestTag } from '../jsdoc-tags.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');

// `fix: true` applies fixes and drops the fixed messages, so reporting and fixing
// have to be linted separately.
const lint = async (fixture: string, options: Record<string, unknown> = {}, fix = false) => {
    const eslint = new ESLint({
        cwd: fixturesDir,
        overrideConfigFile: true,
        fix,
        overrideConfig: {
            files: ['**/*.ts'],
            languageOptions: {
                parser: tseslint.parser,
                parserOptions: {
                    jsDocParsingMode: 'all',
                },
            },
            plugins: { kizuna: { rules: { 'valid-jsdoc-tags': validJsDocTags } } },
            rules: { 'kizuna/valid-jsdoc-tags': ['error', options] },
        } as never,
    });
    const [result] = await eslint.lintFiles([path.join(fixturesDir, fixture)]);
    return result;
};

describe('nearestTag', () => {
    it('names the tag a misspelling was reaching for', () => {
        expect(nearestTag('descriptionn')).toBe('description');
        expect(nearestTag('exmaple')).toBe('example');
        expect(nearestTag('depricated')).toBe('deprecated');
        expect(nearestTag('sumary')).toBe('summary');
    });

    it('leaves the tags kizuna reads alone', () => {
        expect(nearestTag('description')).toBeUndefined();
        expect(nearestTag('example')).toBeUndefined();
    });

    it('leaves ordinary JSDoc tags alone, however close they look', () => {
        expect(nearestTag('param')).toBeUndefined();
        expect(nearestTag('see')).toBeUndefined();
        expect(nearestTag('internal')).toBeUndefined();
        expect(nearestTag('default')).toBeUndefined();
    });

    it('does not reach for a tag that is simply unrelated', () => {
        expect(nearestTag('customCompanyTag')).toBeUndefined();
        expect(nearestTag('openapi')).toBeUndefined();
    });
});

describe('valid-jsdoc-tags', () => {
    const idsOf = async (fixture: string, options: Record<string, unknown> = {}) =>
        ((await lint(fixture, options))?.messages ?? []).map((message) => message.messageId);

    it('flags every tag that is not one of the four ts-kizuna reads', async () => {
        expect(await idsOf('contract-jsdoc-tags.ts')).toEqual([
            'unknownTag',
            'emptyTag',
            'unknownTag',
            'duplicateTag',
            'longSummary',
            'unknownTag',
            'unknownTag',
        ]);
    });

    it('says only that the tag is not read, without guessing in the message', async () => {
        const messages = (await lint('contract-jsdoc-tags.ts'))?.messages ?? [];
        const unknown = messages.filter((message) => message.messageId === 'unknownTag');
        expect(unknown[0]?.message).toBe(
            '`@descriptionn` is not read by ts-kizuna. Contract JSDoc carries only @description, @summary, @example, and @deprecated.'
        );
        expect(unknown.every((message) => !message.message.includes('Did you mean'))).toBe(true);
    });

    it('offers a fix for a near miss, and none for an ordinary JSDoc tag', async () => {
        const messages = (await lint('contract-jsdoc-tags.ts'))?.messages ?? [];
        const unknown = messages.filter((message) => message.messageId === 'unknownTag');
        expect(unknown.map((message) => message.fix !== undefined)).toEqual([true, true, false, false]);
    });

    it('autofixes a near-miss tag to the tag it meant', async () => {
        const result = await lint('contract-jsdoc-tags.ts', {}, true);
        expect(result?.output).toContain('@description Creates a user.');
        expect(result?.output).toContain('@example Ada Lovelace');
        expect(result?.output).not.toContain('@descriptionn');
    });

    it('flags a second @description, which the parser silently drops', async () => {
        const messages = (await lint('contract-jsdoc-tags.ts'))?.messages ?? [];
        const duplicate = messages.find((message) => message.messageId === 'duplicateTag');
        expect(duplicate?.message).toContain('keeps the first and drops this one');
    });

    it('leaves repeated @example alone, since the parser collects every one', async () => {
        expect(await idsOf('contract-jsdoc-clean.ts')).toEqual([]);
    });

    it('flags a tag with no text after it, but not a bare @deprecated', async () => {
        const messages = (await lint('contract-jsdoc-tags.ts'))?.messages ?? [];
        expect(messages.filter((message) => message.messageId === 'emptyTag')).toHaveLength(1);
    });

    it('flags a summary past the length an OpenAPI list view shows', async () => {
        const messages = (await lint('contract-jsdoc-tags.ts'))?.messages ?? [];
        const long = messages.filter((message) => message.messageId === 'longSummary');
        expect(long).toHaveLength(1);
        expect(long[0]?.message).toContain('so move the detail to `@description`');
    });

    it('takes the summary limit from options', async () => {
        expect(await idsOf('contract-jsdoc-clean.ts', { maxSummaryLength: 5 })).toEqual(['longSummary']);
    });

    it('leaves untagged prose alone: it is a note to the reader, not documentation that ships', async () => {
        const messages = (await lint('contract-jsdoc-tags.ts'))?.messages ?? [];
        expect(messages.some((message) => message.message.includes('A note to whoever reads this'))).toBe(false);
    });

    it('reports nothing on a correctly tagged contract', async () => {
        expect(await idsOf('contract-jsdoc-clean.ts')).toEqual([]);
    });
});
