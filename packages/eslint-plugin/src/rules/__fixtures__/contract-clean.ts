import { Kizuna } from '@ts-kizuna/core';
import { CleanQuery } from './shared-schemas.js';

const { k } = Kizuna.init();

export const routes = k.routes({
    a: {
        method: 'GET',
        path: '/a',
        query: CleanQuery,
        responses: {},
    },
});
