import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { noUnsupportedSchema } from './no-unsupported-schema.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');

const messageIdsFor = async (fixture: string, parserOptions: Record<string, unknown>): Promise<(string | undefined)[]> => {
    const eslint = new ESLint({
        cwd: fixturesDir,
        overrideConfigFile: true,
        overrideConfig: {
            files: ['**/*.ts'],
            languageOptions: {
                parser: tseslint.parser,
                parserOptions,
            },
            plugins: { kizuna: { rules: { 'no-unsupported-schema': noUnsupportedSchema } } },
            rules: { 'kizuna/no-unsupported-schema': 'error' },
        } as never,
    });
    const [result] = await eslint.lintFiles([path.join(fixturesDir, fixture)]);
    return (result?.messages ?? []).map((message) => message.messageId);
};

// Type-aware parsing resolves via the checker; plain parsing falls back to the source resolver.
// Both must produce identical results, that's the point: no project service needed.
describe.each([
    ['with type information', { project: ['./tsconfig.json'], tsconfigRootDir: fixturesDir }],
    ['without type information', { jsDocParsingMode: 'all' }],
])('no-unsupported-schema (%s)', (_label, parserOptions) => {
    it('flags imported schemas with the reference-variant messages, on the reference', async () => {
        expect(await messageIdsFor('contract-violations.ts', parserOptions)).toEqual([
            'coerceReference',
            'jsdocTagReference',
            'duplicateDeprecatedReference',
            'coerceReference',
        ]);
    });

    it('leaves a clean referenced schema alone', async () => {
        expect(await messageIdsFor('contract-clean.ts', parserOptions)).toEqual([]);
    });

    it('uses the reference variant for a named same-file schema', async () => {
        expect(await messageIdsFor('contract-local.ts', parserOptions)).toEqual(['coerceReference']);
    });

    it('uses the direct variant for inline contract schemas', async () => {
        expect(await messageIdsFor('contract-inline.ts', parserOptions)).toEqual(['coerce']);
    });

    it('uses the direct variant on Kizuna.model fields', async () => {
        expect(await messageIdsFor('contract-model.ts', parserOptions)).toEqual(['coerce', 'jsdocTag', 'duplicateDeprecated']);
    });
});
