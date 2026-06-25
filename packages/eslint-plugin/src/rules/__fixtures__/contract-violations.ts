import { kizuna } from '@ts-kizuna/core';
import { CoercedQuery, DeprecatedLinkSchema, DuplicateDeprecatedSchema, NestedCoerced } from './shared-schemas.js';

const { k } = kizuna();

export const routes = k.routes({
    a: {
        method: 'GET',
        path: '/a',
        query: CoercedQuery,
        responses: {},
    },
    b: {
        method: 'POST',
        path: '/b',
        body: DeprecatedLinkSchema,
        responses: {},
    },
    c: {
        method: 'POST',
        path: '/c',
        body: DuplicateDeprecatedSchema,
        responses: {},
    },
    d: {
        method: 'GET',
        path: '/d',
        query: NestedCoerced,
        responses: {},
    },
});
