import { kizuna } from '@ts-kizuna/core';
import { tags } from './tags.js';
import { user, member, inviteToken } from './identities.js';
import { analytics } from './request-contexts.js';

export const { k } = kizuna({
    identities: {
        user,
        member,
        inviteToken,
    },
    requestContext: {
        analytics,
    },
    tags,
    validation: {
        issueCodes: ['invalid_phone_number'],
    },
});
