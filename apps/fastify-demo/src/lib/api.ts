import { server } from './server';
import { requireUser, requireMember, requireInviteToken } from './guards';
import { captureAnalytics } from './request-context';
import { router } from './router';

export const api = server.api({
    router,
    guards: {
        user: requireUser,
        member: requireMember,
        inviteToken: requireInviteToken,
    },
    requestContext: {
        analytics: captureAnalytics,
    },
});
