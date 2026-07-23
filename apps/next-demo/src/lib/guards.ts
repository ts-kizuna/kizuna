import { sessions, memberships, inviteTokens } from '@ts-kizuna-demo/shared';
import { server } from './server';

export const requireUser = server.guard('user', ({ bearer, deny }) => {
    const session = bearer ? sessions.get(bearer.token) : undefined;
    if (!session) {
        return deny(401, 'Unauthorized');
    }
    return {
        userId: session.userId,
    };
});

export const requireMember = server.guard('member', ({ apiKey, deny }) => {
    const membership = apiKey ? memberships.get(apiKey.value) : undefined;
    if (!membership) {
        return deny(403, 'Forbidden');
    }
    return membership;
});

export const requireInviteToken = server.guard('inviteToken', ({ params, deny }) => {
    const inviteId = params.token ? inviteTokens.get(params.token) : undefined;
    if (!inviteId) {
        return deny(404, 'Not found');
    }
    return {
        inviteId,
    };
});
