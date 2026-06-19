import { kizuna } from '@ts-kizuna/core';
import { CleanQuery } from './shared-schemas.js';

const { k } = kizuna();

export const routes = k.routes({
    a: {
        method: 'GET',
        path: '/a',
        query: CleanQuery,
        responses: {},
    },
});
