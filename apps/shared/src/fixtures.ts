export const sessions = new Map<string, { userId: string }>([
    ['tok_ada', { userId: '1' }],
    ['tok_linus', { userId: '2' }],
]);

export const memberships = new Map<string, { workspaceUserId: string; role: 'owner' | 'admin' }>([
    ['wst_owner', { workspaceUserId: '1', role: 'owner' }],
    ['wst_admin', { workspaceUserId: '2', role: 'admin' }],
]);

export const inviteTokens = new Map<string, string>([['inv_9x2k7q', 'invite_1']]);

export const inviteEmails = new Map<string, string>([['invite_1', 'grace@example.com']]);
