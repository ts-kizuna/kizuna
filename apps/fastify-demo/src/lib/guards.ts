import { db } from '@ts-kizuna-demo/shared';
import { server } from './server';

export const requireUser = server.guard('user', async ({ bearer, unauthenticated }) => {
    const session = bearer ? await db.sessions.findByToken(bearer.token) : null;
    if (!session) {
        return unauthenticated();
    }
    return {
        userId: session.userId,
    };
});

export const requireMember = server.guard('member', async ({ apiKey, unauthenticated }) => {
    const membership = apiKey ? await db.memberships.findByApiKey(apiKey.value) : null;
    if (!membership) {
        return unauthenticated();
    }
    return membership;
});

export const requireInviteToken = server.guard('inviteToken', async ({ params, unauthenticated }) => {
    const invite = params.token ? await db.invites.findByToken(params.token) : null;
    if (!invite) {
        return unauthenticated();
    }
    return {
        inviteId: invite.id,
        email: invite.email,
    };
});

/**
 * The shared secret the platform scheduler sends. Every job requires it.
 */
export const requireScheduler = server.guard('scheduler', ({ bearer, unauthenticated }) => {
    const secret = process.env.CRON_SECRET ?? 'dev-cron-secret';
    if (bearer?.token !== secret) {
        return unauthenticated();
    }
    return {
        invokedAt: new Date().toISOString(),
    };
});
