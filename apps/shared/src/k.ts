import { Kizuna } from '@ts-kizuna/core';
import { groups } from './groups';
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
    groups,
    validation: {
        issueCodes: ['invalid_phone_number'],
    },
});
