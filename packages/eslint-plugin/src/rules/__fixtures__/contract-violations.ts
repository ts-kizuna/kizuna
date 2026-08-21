import { Kizuna } from '@ts-kizuna/core';
import { CoercedQuery, NestedCoerced } from './shared-schemas.js';

const k = new Kizuna();

export const routes = k.routes({
    a: {
        method: 'GET',
        path: '/a',
        query: CoercedQuery,
        responses: {},
    },
    d: {
        method: 'GET',
        path: '/d',
        query: NestedCoerced,
        responses: {},
    },
});
