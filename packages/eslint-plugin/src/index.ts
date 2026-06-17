import type { ESLint, Linter, Rule } from 'eslint';
import parser from '@typescript-eslint/parser';
import packageJson from '../package.json';
import { noUnsupportedSchema } from './rules/no-unsupported-schema.js';

const plugin: ESLint.Plugin = {
    meta: {
        name: packageJson.name,
        version: packageJson.version,
        namespace: '@ts-kizuna',
    },
    rules: {
        'no-unsupported-schema': noUnsupportedSchema as unknown as Rule.RuleModule,
    },
};

/**
 * Flat config enabling every ts-kizuna rule.
 *
 * ```js
 * import kizuna from '@ts-kizuna/eslint-plugin';
 *
 * export default [kizuna.configs.recommended];
 * ```
 */
const recommended: Linter.Config = {
    name: '@ts-kizuna/recommended',
    files: ['**/*.ts', '**/*.cts', '**/*.mts', '**/*.tsx'],
    plugins: {
        '@ts-kizuna': plugin,
    },
    languageOptions: {
        parser: parser as Linter.Parser,
        parserOptions: {
            projectService: true,
        },
    },
    rules: {
        '@ts-kizuna/no-unsupported-schema': 'error',
    },
};

const eslintPlugin: ESLint.Plugin & { configs: { recommended: Linter.Config } } = {
    ...plugin,
    configs: {
        recommended,
    },
};

export default eslintPlugin;
