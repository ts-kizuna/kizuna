import { Kizuna } from '@ts-kizuna/contract';
import { z } from 'zod';

export const Model = Kizuna.model({
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
