// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import prettier from 'eslint-plugin-prettier/recommended';
import jsdoc from 'eslint-plugin-jsdoc';
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
            plugins: {
                ...prettier.plugins,
                jsdoc,
            },
            rules: {
                'prettier/prettier': 'warn',
                '@typescript-eslint/no-empty-object-type': 'off',
                '@typescript-eslint/no-unused-vars': 'off',
                '@typescript-eslint/no-explicit-any': 'off',
                'jsdoc/multiline-blocks': ['warn', { noSingleLineBlocks: true }],
                'jsdoc/require-asterisk-prefix': ['warn', 'always'],
            },
        }
    ),
    kizuna.configs.recommended,
];
