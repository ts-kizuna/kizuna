import { Kizuna } from '@ts-kizuna/shared';
import { z } from 'zod';

const k = new Kizuna();

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
