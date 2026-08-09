import { Kizuna } from '@ts-kizuna/core';
import { mcpPlugin } from '@ts-kizuna/mcp';
import { openApiDocsPlugin } from '@ts-kizuna/openapi';
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
        openApiDocs: openApiDocsPlugin({
            info: {
                title: 'ts-kizuna demo',
                version: '1.0.0',
                description: 'The ts-kizuna user API, shared by every adapter demo.',
            },
            setOperationId: true,
        }),
    },
});
