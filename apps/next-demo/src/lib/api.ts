import { KizunaApi } from '@ts-kizuna/next';
import { contract } from '@ts-kizuna-demo/shared';
import { requireUser, requireMember, requireInviteToken } from './guards';
import { captureAnalytics } from './request-context';
import { router } from './router';

export const api = new KizunaApi({
    contract,
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
