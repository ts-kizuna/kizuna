import { Kizuna } from '@ts-kizuna/core';
import { mcpPlugin } from '@ts-kizuna/mcp';
import { openApiPlugin } from '@ts-kizuna/openapi';
import { tags } from './tags.js';
import { user, member, inviteToken, scheduler } from './identities.js';
import { analytics } from './request-contexts.js';
import { manageMembers, promoteMember, removeMember } from './permissions.js';

export const k = new Kizuna({
    identities: {
        user,
        member,
        inviteToken,
        scheduler,
    },
    permissions: {
        promoteMember,
        manageMembers,
        removeMember,
    },
    settings: {
        permissions: {
            path: '/permissions',
            identity: 'user',
        },
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
        openApi: openApiPlugin({
            info: {
                title: 'ts-kizuna demo',
                version: '1.0.0',
                description: 'The ts-kizuna user API, shared by every adapter demo.',
            },
            setOperationId: true,
            docsPath: '/docs',
            jsonPath: '/openapi.json',
        }),
    },
});
