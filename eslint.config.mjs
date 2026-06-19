// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import prettier from 'eslint-plugin-prettier/recommended';
import kizuna from '@ts-kizuna/eslint-plugin';

export default [
    ...tseslint.config(
        {
            ignores: ['node_modules', '**/dist', '**/build', '**/.turbo', '**/.source', '**/__fixtures__/**'],
        },
        eslint.configs.recommended,
        ...tseslint.configs.recommended,
        eslintConfigPrettier,
        {
            ...prettier,
            languageOptions: {},
            rules: {
                'prettier/prettier': 'warn',
                '@typescript-eslint/no-empty-object-type': 'off',
                '@typescript-eslint/no-unused-vars': 'off',
                '@typescript-eslint/no-explicit-any': 'off',
            },
        }
    ),
    kizuna.configs.recommended,
];
