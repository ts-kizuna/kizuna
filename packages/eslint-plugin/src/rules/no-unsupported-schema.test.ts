import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { noUnsupportedSchema } from './no-unsupported-schema.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');

const messageIdsFor = async (fixture: string): Promise<(string | undefined)[]> => {
    const eslint = new ESLint({
        cwd: fixturesDir,
        overrideConfigFile: true,
        overrideConfig: {
            files: ['**/*.ts'],
            languageOptions: {
                parser: tseslint.parser,
                parserOptions: {
                    project: ['./tsconfig.json'],
                    tsconfigRootDir: fixturesDir,
                },
            },
            plugins: { kizuna: { rules: { 'no-unsupported-schema': noUnsupportedSchema } } },
            rules: { 'kizuna/no-unsupported-schema': 'error' },
        } as never,
    });
    const [result] = await eslint.lintFiles([path.join(fixturesDir, fixture)]);
    return (result?.messages ?? []).map((message) => message.messageId);
};

describe('no-unsupported-schema', () => {
    it('flags imported schemas with the reference-variant messages, on the reference', async () => {
        expect(await messageIdsFor('contract-violations.ts')).toEqual([
            'coerceReference',
            'jsdocTagReference',
            'duplicateDeprecatedReference',
            'coerceReference',
        ]);
    });

    it('leaves a clean referenced schema alone', async () => {
        expect(await messageIdsFor('contract-clean.ts')).toEqual([]);
    });

    it('uses the reference variant for a named same-file schema', async () => {
        expect(await messageIdsFor('contract-local.ts')).toEqual(['coerceReference']);
    });

    it('uses the direct variant for inline contract schemas', async () => {
        expect(await messageIdsFor('contract-inline.ts')).toEqual(['coerce']);
    });

    it('uses the direct variant on createModel fields', async () => {
        expect(await messageIdsFor('contract-model.ts')).toEqual(['coerce', 'jsdocTag', 'duplicateDeprecated']);
    });
});
