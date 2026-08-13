import { mcpPluginServer } from '@ts-kizuna/mcp/server';
import { openApiPluginServer } from '@ts-kizuna/openapi/server';
import { server } from './server';
import { requireUser, requireMember, requireInviteToken, requireScheduler } from './guards';
import { captureAnalytics } from './request-context';
import { canViewEventLog, canPromoteMember, canManageMembers, canRemoveMember } from './permissions';
import { router } from './router/index';
import { jobHandlers } from './jobs';

export const api = server.api({
    router,
    jobs: jobHandlers,
    guards: {
        user: requireUser,
        member: requireMember,
        inviteToken: requireInviteToken,
        scheduler: requireScheduler,
    },
    permissions: {
        viewEventLog: canViewEventLog,
        promoteMember: canPromoteMember,
        manageMembers: canManageMembers,
        removeMember: canRemoveMember,
    },
    requestContext: {
        analytics: captureAnalytics,
    },
    plugins: {
        mcp: mcpPluginServer(),
        openApi: openApiPluginServer(),
    },
});
