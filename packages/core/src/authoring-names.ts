import type { Kizuna, K } from './kizuna.js';

/**
 * Member names the CLI's JSDoc parser and the ESLint plugin match on in
 * source text. Asserted against the real surface so a rename fails to compile
 * here rather than silently matching nothing.
 */
export const AUTHORING_NAMES = {
    model: 'model',
    routes: 'routes',
    contract: 'contract',
    router: 'router',
} as const satisfies {
    model: keyof typeof Kizuna;
    routes: keyof K;
    contract: keyof K;
    router: string;
};

/**
 * Export names the JSDoc parser treats as a contract entry point.
 */
export const CONTRACT_EXPORT_NAMES = ['contract', 'api'] as const;

/**
 * The JSDoc tags kizuna reads off a route or a schema field. The parser and the
 * ESLint plugin share this list, so a tag the parser understands is exactly one
 * the linter accepts.
 */
export const JSDOC_TAGS = ['description', 'summary', 'example', 'deprecated'] as const;

export type JsDocTag = (typeof JSDOC_TAGS)[number];

/**
 * Tags that are ordinary TypeScript or JSDoc vocabulary. kizuna ignores them, but
 * the linter must not mistake one for a misspelling of a tag it does read.
 */
export const KNOWN_FOREIGN_JSDOC_TAGS: readonly string[] = [
    'param',
    'returns',
    'return',
    'throws',
    'see',
    'link',
    'todo',
    'remarks',
    'internal',
    'public',
    'private',
    'protected',
    'readonly',
    'override',
    'default',
    'defaultValue',
    'since',
    'author',
    'license',
    'module',
    'packageDocumentation',
    'template',
    'typeParam',
    'type',
    'satisfies',
    'experimental',
    'beta',
    'alpha',
    'inheritDoc',
    'group',
    'category',
    'eslint',
    'ts-ignore',
    'ts-expect-error',
];
