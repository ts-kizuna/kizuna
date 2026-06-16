import { RuleTester } from 'eslint';
import { noZCoerce } from './no-z-coerce.js';

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
    },
});

ruleTester.run('no-z-coerce', noZCoerce, {
    valid: [
        {
            name: 'plain schemas in a contract file',
            code: `
                import { createContract } from '@ts-kizuna/core';
                import { z } from 'zod';
                const query = z.object({ page: z.number(), from: z.date(), cursor: z.bigint() });
            `,
        },
        {
            name: 'transform/pipe in a contract file',
            code: `
                import { createContract } from '@ts-kizuna/core';
                import { z } from 'zod';
                const limit = z.string().transform((value) => Number(value));
            `,
        },
        {
            name: 'z.coerce in a file that does not import ts-kizuna is left alone',
            code: `
                import { z } from 'zod';
                const query = z.object({ page: z.coerce.number() });
            `,
        },
        {
            name: 'unrelated .coerce property on a non-z object',
            code: `
                import { createContract } from '@ts-kizuna/core';
                const result = helper.coerce(value);
            `,
        },
    ],
    invalid: [
        {
            name: 'z.coerce.number() in a contract file',
            code: `
                import { createContract } from '@ts-kizuna/core';
                import { z } from 'zod';
                const query = z.object({ page: z.coerce.number() });
            `,
            errors: [{ messageId: 'noCoerce' }],
        },
        {
            name: 'z.coerce.date() flagged when importing any @ts-kizuna package',
            code: `
                import { createClient } from '@ts-kizuna/fetch';
                import { z } from 'zod';
                const since = z.coerce.date();
            `,
            errors: [{ messageId: 'noCoerce' }],
        },
        {
            name: 'multiple z.coerce usages each report',
            code: `
                import { createContract } from '@ts-kizuna/core';
                import { z } from 'zod';
                const query = z.object({ page: z.coerce.number(), cursor: z.coerce.bigint() });
            `,
            errors: [{ messageId: 'noCoerce' }, { messageId: 'noCoerce' }],
        },
    ],
});
