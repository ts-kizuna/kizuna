import { createModel } from '@ts-kizuna/core';
import { z } from 'zod';

export const Model = createModel({
    title: 'Model',
    schema: z.object({
        page: z.coerce.number(),
        /**
         * @deprecated use {@link other} instead.
         */
        legacy: z.string(),
        /**
         * @deprecated first
         * @deprecated second
         */
        dup: z.string(),
    }),
});
