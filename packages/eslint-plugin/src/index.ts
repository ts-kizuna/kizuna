import type { ESLint, Linter } from 'eslint';
import packageJson from '../package.json';
import { noDuplicateDeprecated } from './rules/no-duplicate-deprecated.js';
import { noJsdocTagsInDeprecations } from './rules/no-jsdoc-tags-in-deprecations.js';
import { noZCoerce } from './rules/no-z-coerce.js';

const plugin: ESLint.Plugin = {
    meta: {
        name: packageJson.name,
        version: packageJson.version,
        namespace: '@ts-kizuna',
    },
    rules: {
        'no-duplicate-deprecated': noDuplicateDeprecated,
        'no-jsdoc-tags-in-deprecations': noJsdocTagsInDeprecations,
        'no-z-coerce': noZCoerce,
    },
};

/**
 * Flat config enabling every ts-kizuna rule. Add it to your `eslint.config.js`:
 *
 * ```js
 * import kizuna from '@ts-kizuna/eslint-plugin';
 *
 * export default [kizuna.configs.recommended];
 * ```
 */
const recommended: Linter.Config = {
    name: '@ts-kizuna/recommended',
    plugins: {
        '@ts-kizuna': plugin,
    },
    rules: {
        '@ts-kizuna/no-duplicate-deprecated': 'error',
        '@ts-kizuna/no-jsdoc-tags-in-deprecations': 'error',
        '@ts-kizuna/no-z-coerce': 'error',
    },
};

const eslintPlugin: ESLint.Plugin & { configs: { recommended: Linter.Config } } = {
    ...plugin,
    configs: {
        recommended,
    },
};

export default eslintPlugin;
