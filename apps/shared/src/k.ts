import { Kizuna } from '@ts-kizuna/core';
import { tags } from './tags';
import { user, member, inviteToken, scheduler } from './identities';
import { analytics } from './request-context';

export const k = new Kizuna({
    identities: {
        user,
        member,
        inviteToken,
        scheduler,
    },
    requestContext: {
        analytics,
    },
    tags,
    validation: {
        issueCodes: ['invalid_phone_number'],
    },
});
