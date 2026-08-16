import { Kizuna } from '@ts-kizuna/shared';
import { CleanQuery } from './shared-schemas.js';

const k = new Kizuna();

export const routes = k.routes({
    a: {
        method: 'GET',
        path: '/a',
        query: CleanQuery,
        responses: {},
    },
});
