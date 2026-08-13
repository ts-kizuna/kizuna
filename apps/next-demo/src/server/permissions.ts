import { db } from '@ts-kizuna-demo/shared';
import { server } from './server';

/**
 * Ownership may only be handed to someone already in the workspace. The
 * membership set loads once per request, so the predicate is a set test rather
 * than a query per candidate.
 */
export const canPromoteMember = server.permission('promoteMember', async () => {
    const memberIds = await db.memberships.findUserIds();
    return (candidate) => memberIds.has(candidate.id);
});

export const canManageMembers = server.permission('manageMembers', async ({ auth }) => {
    const userId = auth.user?.userId ?? auth.member?.workspaceUserId;
    if (!userId) return false;
    const roles = await db.memberships.findRolesByUserId();
    const role = roles.get(userId);
    return role === 'owner' || role === 'admin';
});

export const canRemoveMember = server.permission('removeMember', async () => {
    const roles = await db.memberships.findRolesByUserId();
    return (member) => roles.get(member.id) !== 'owner';
});
