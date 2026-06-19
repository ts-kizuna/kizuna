import { kizuna } from '@ts-kizuna/core';
import { tags } from './tags.js';

export const { k } = kizuna({
    tags,
    validation: {
        issueCodes: ['invalid_phone_number'],
    },
});
