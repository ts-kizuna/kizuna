import { RuleTester } from 'eslint';
import { noDuplicateDeprecated } from './no-duplicate-deprecated.js';

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
    },
});

ruleTester.run('no-duplicate-deprecated', noDuplicateDeprecated, {
    valid: [
        {
            name: 'a single @deprecated tag is fine',
            code: `
                import { createContract } from '@ts-kizuna/core';
                /**
                 * @deprecated Use createUser instead.
                 */
                const route = {};
            `,
        },
        {
            name: 'multi-line @deprecated message is one tag',
            code: `
                import { createContract } from '@ts-kizuna/core';
                /**
                 * @deprecated Use createUser instead — the old route is gone
                 * and this continuation line is not a second tag.
                 */
                const route = {};
            `,
        },
        {
            name: '@deprecated alongside other block tags is fine',
            code: `
                import { createContract } from '@ts-kizuna/core';
                /**
                 * Creates a user.
                 * @deprecated Use createUser instead.
                 * @see createUser
                 */
                const route = {};
            `,
        },
        {
            name: 'two @deprecated tags in a file that does not import ts-kizuna are left alone',
            code: `
                /**
                 * @deprecated First message.
                 * @deprecated Second message.
                 */
                const route = {};
            `,
        },
    ],
    invalid: [
        {
            name: 'two @deprecated tags in one block',
            code: `
                import { createContract } from '@ts-kizuna/core';
                /**
                 * @deprecated First message.
                 * @deprecated Second message — silently dropped.
                 */
                const route = {};
            `,
            errors: [{ messageId: 'duplicate' }],
        },
        {
            name: 'reports once on the documented declaration, anchored to the field',
            code: [
                `import { createContract } from '@ts-kizuna/core';`,
                `import { z } from 'zod';`,
                `const User = z.object({`,
                `    /**`,
                `     * @deprecated use email_address instead.`,
                `     * @deprecated really, use email_address.`,
                `     */`,
                `    email: z.email(),`,
                `});`,
            ].join('\n'),
            // The `email` key is on line 8, column 5 — not the comment on lines 4-7.
            errors: [{ messageId: 'duplicate', line: 8, column: 5 }],
        },
    ],
});
