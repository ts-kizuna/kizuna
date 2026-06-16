import type { ESLint, Linter } from 'eslint';
import packageJson from '../package.json';
import { noZCoerce } from './rules/no-z-coerce.js';

const plugin: ESLint.Plugin = {
    meta: {
        name: packageJson.name,
        version: packageJson.version,
        namespace: '@ts-kizuna',
    },
    rules: {
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
