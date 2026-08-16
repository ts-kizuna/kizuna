import { Kizuna } from '@ts-kizuna/contract';
import { mcpPlugin } from '@ts-kizuna/mcp';
import { openApiPlugin } from '@ts-kizuna/openapi';
import { tags } from './tags.js';
import { user, member, inviteToken, scheduler } from './identities.js';
import { analytics } from './request-contexts.js';

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
