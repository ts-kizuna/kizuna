import { mcpPluginServer } from '@ts-kizuna/mcp/server';
import { openApiPluginServer } from '@ts-kizuna/openapi/server';
import { server } from './server';
import { requireUser, requireMember, requireInviteToken, requireScheduler } from './guards';
import { captureAnalytics } from './request-context';
import { router } from './router/index';
import { jobHandlers } from './jobs';
import { webhookConfig } from './webhooks';

export const api = server.api({
    router,
    jobs: jobHandlers,
    webhooks: webhookConfig,
    guards: {
        user: requireUser,
        member: requireMember,
        inviteToken: requireInviteToken,
        scheduler: requireScheduler,
    },
    requestContext: {
        analytics: captureAnalytics,
    },
    plugins: {
        mcp: mcpPluginServer(),
        openApi: openApiPluginServer(),
    },
});
