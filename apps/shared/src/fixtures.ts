export interface User {
    id: string;
    name: string;
    email: string;
    last_name?: string;
}

export const users = new Map<string, User>([
    ['1', { id: '1', name: 'Ada Lovelace', email: 'ada@example.com', last_name: 'Lovelace' }],
    ['2', { id: '2', name: 'Linus Torvalds', email: 'linus@example.com' }],
]);

export const archivedUsers = new Set<string>();

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
