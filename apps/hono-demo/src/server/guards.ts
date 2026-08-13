import { db } from '@ts-kizuna-demo/shared';
import { server } from './server';

export const requireUser = server.guard('user', async ({ bearer, deny }) => {
    const session = bearer ? await db.sessions.findByToken(bearer.token) : null;
    if (!session) {
        return deny(401, 'Unauthorized');
    }
    return {
        userId: session.userId,
    };
});

export const requireMember = server.guard('member', async ({ apiKey, deny }) => {
    const membership = apiKey ? await db.memberships.findByApiKey(apiKey.value) : null;
    if (!membership) {
        return deny(403, 'Forbidden');
    }
    return membership;
});

export const requireInviteToken = server.guard('inviteToken', async ({ params, deny }) => {
    const invite = params.token ? await db.invites.findByToken(params.token) : null;
    if (!invite) {
        return deny(404, 'Not found');
    }
    return {
        inviteId: invite.id,
        email: invite.email,
    };
});

/**
 * The shared secret the platform scheduler sends. Every job requires it.
 */
export const requireScheduler = server.guard('scheduler', ({ bearer, deny }) => {
    const secret = process.env.CRON_SECRET ?? 'dev-cron-secret';
    if (bearer?.token !== secret) {
        return deny(401, 'Unauthorized');
    }
    return {
        invokedAt: new Date().toISOString(),
    };
});
