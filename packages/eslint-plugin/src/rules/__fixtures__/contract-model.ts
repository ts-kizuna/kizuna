import { Kizuna } from '@ts-kizuna/core';
import { z } from 'zod';

export const Model = Kizuna.model({
    title: 'Model',
    schema: z.object({
        page: z.coerce.number(),
    }),
});
