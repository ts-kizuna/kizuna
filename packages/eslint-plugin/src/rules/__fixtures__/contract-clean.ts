import { createContract } from '@ts-kizuna/core';
import { CleanQuery } from './shared-schemas.js';

export const contract = createContract({
    a: {
        method: 'GET',
        path: '/a',
        query: CleanQuery,
        responses: {},
    },
});
