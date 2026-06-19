import { createContract } from '@ts-kizuna/core';
import { z } from 'zod';

const LocalQuery = z.object({
    page: z.coerce.number(),
});

export const contract = createContract({
    a: {
        method: 'GET',
        path: '/a',
        query: LocalQuery,
        responses: {},
    },
});
