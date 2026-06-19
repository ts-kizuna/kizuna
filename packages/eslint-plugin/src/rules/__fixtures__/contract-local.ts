import { kizuna } from '@ts-kizuna/core';
import { z } from 'zod';

const { k } = kizuna();

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
