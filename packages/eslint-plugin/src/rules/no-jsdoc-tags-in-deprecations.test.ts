import { RuleTester } from 'eslint';
import { noJsdocTagsInDeprecations } from './no-jsdoc-tags-in-deprecations.js';

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
    },
});

ruleTester.run('no-jsdoc-tags-in-deprecations', noJsdocTagsInDeprecations, {
    valid: [
        {
            name: 'plain-text @deprecated message in a contract file',
            code: `
                import { createContract } from '@ts-kizuna/core';
                /**
                 * @deprecated Use createUser instead.
                 */
                const route = {};
            `,
        },
        {
            name: 'backticks in a @deprecated message are allowed',
            code: `
                import { createContract } from '@ts-kizuna/core';
                /**
                 * @deprecated Use \`createUser\` instead — \`listEvents\` no longer accepts this field.
                 */
                const route = {};
            `,
        },
        {
            name: '{@link} outside a @deprecated tag is left alone',
            code: `
                import { createContract } from '@ts-kizuna/core';
                /**
                 * Creates a user. See {@link UserSchema} for the shape.
                 */
                const route = {};
            `,
        },
        {
            name: '{@link} after the @deprecated block ends is left alone',
            code: `
                import { createContract } from '@ts-kizuna/core';
                /**
                 * @deprecated Use createUser instead.
                 * @see {@link UserSchema}
                 */
                const route = {};
            `,
        },
        {
            name: '{@link} in a @deprecated message of a file that does not import ts-kizuna is left alone',
            code: `
                /**
                 * @deprecated Use {@link createUser} instead.
                 */
                const route = {};
            `,
        },
    ],
    invalid: [
        {
            name: '{@link} in a single-line @deprecated message',
            code: `
                import { createContract } from '@ts-kizuna/core';
                /** @deprecated Use {@link createUser} instead. */
                const route = {};
            `,
            errors: [{ messageId: 'noTag' }],
        },
        {
            name: '{@link} on a continuation line of a @deprecated message',
            code: `
                import { createClient } from '@ts-kizuna/fetch';
                /**
                 * @deprecated
                 * Use {@link createUser} instead.
                 */
                const route = {};
            `,
            errors: [{ messageId: 'noTag' }],
        },
        {
            name: 'reports once on the documented declaration even with multiple tags',
            code: `
                import { createContract } from '@ts-kizuna/core';
                /**
                 * @deprecated See [the docs]{@link https://example.com} and {@link createUser}.
                 */
                const route = {};
            `,
            errors: [{ messageId: 'noTag' }],
        },
        {
            name: '{@linkcode} and {@tutorial} are flagged too',
            code: `
                import { createContract } from '@ts-kizuna/core';
                /**
                 * @deprecated Replaced — see {@linkcode createUser} and {@tutorial migration}.
                 */
                const route = {};
            `,
            errors: [{ messageId: 'noTag' }],
        },
        {
            name: 'error is anchored to the deprecated field, not the JSDoc comment',
            code: [
                `import { createContract } from '@ts-kizuna/core';`,
                `import { z } from 'zod';`,
                `const User = z.object({`,
                `    /**`,
                `     * @deprecated use \`email_address\` {@link} instead.`,
                `     */`,
                `    email: z.email(),`,
                `});`,
            ].join('\n'),
            // The `email` key is on line 7, column 5 — not the comment on lines 4-6.
            errors: [{ messageId: 'noTag', line: 7, column: 5 }],
        },
    ],
});
