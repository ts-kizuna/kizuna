import { Kizuna } from '@ts-kizuna/core';
import { z } from 'zod';

const { k } = Kizuna.init();

const LocalQuery = z.object({
    page: z.coerce.number(),
});

export const routes = k.routes({
    a: {
        method: 'GET',
        path: '/a',
        query: LocalQuery,
        responses: {},
    },
});
