import { kizuna } from '@ts-kizuna/core';
import { z } from 'zod';

const { k } = kizuna();

export const routes = k.routes({
    a: {
        method: 'GET',
        path: '/a',
        query: z.object({
            page: z.coerce.number(),
        }),
        responses: {},
    },
});
