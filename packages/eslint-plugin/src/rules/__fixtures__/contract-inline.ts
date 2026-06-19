import { createContract } from '@ts-kizuna/core';
import { z } from 'zod';

export const contract = createContract({
    a: {
        method: 'GET',
        path: '/a',
        query: z.object({
            page: z.coerce.number(),
        }),
        responses: {},
    },
});
