import { Kizuna } from '@ts-kizuna/core';
import { mcpPlugin } from '@ts-kizuna/mcp';
import { tags } from './tags.js';
import { user, member, inviteToken } from './identities.js';
import { analytics } from './request-contexts.js';

export const { k } = Kizuna.init({
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
    plugins: {
        mcp: mcpPlugin({
            name: 'ts-kizuna demo',
        }),
    },
});
