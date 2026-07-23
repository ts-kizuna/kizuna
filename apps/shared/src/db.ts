import type { User } from './types.js';

const users = new Map<string, User>([
    ['1', { id: '1', name: 'Ada Lovelace', email: 'ada@example.com', last_name: 'Lovelace' }],
    ['2', { id: '2', name: 'Linus Torvalds', email: 'linus@example.com' }],
]);

const archivedUsers = new Set<string>();

const sessions = new Map<string, { userId: string }>([
    ['tok_ada', { userId: '1' }],
    ['tok_linus', { userId: '2' }],
]);

const memberships = new Map<string, { workspaceUserId: string; role: 'owner' | 'admin' }>([
    ['wst_owner', { workspaceUserId: '1', role: 'owner' }],
    ['wst_admin', { workspaceUserId: '2', role: 'admin' }],
]);

interface Invite {
    id: string;
    email: string;
}

const invites = new Map<string, Invite>([['inv_9x2k7q', { id: 'invite_1', email: 'grace@example.com' }]]);

/**
 * In-memory stand-in for a real data layer, async to mimic a database.
 */
export const db = {
    users: {
        findMany: async ({ skip = 0, take = 20 }: { skip?: number; take?: number } = {}): Promise<User[]> =>
            Array.from(users.values()).slice(skip, skip + take),
        count: async (): Promise<number> => users.size,
        findById: async (id: string): Promise<User | null> => users.get(id) ?? null,
        findByEmail: async (email: string): Promise<User | null> => Array.from(users.values()).find((user) => user.email === email) ?? null,
        search: async (
            query: string,
            { cursor = 0, limit = 20 }: { cursor?: number; limit?: number } = {}
        ): Promise<{ users: User[]; nextCursor: number | null }> => {
            const matches = Array.from(users.values()).filter((user) => user.name.toLowerCase().includes(query.toLowerCase()));
            const page = matches.slice(cursor, cursor + limit);
            return {
                users: page,
                nextCursor: cursor + page.length < matches.length ? cursor + page.length : null,
            };
        },
        create: async (user: User): Promise<User> => {
            users.set(user.id, user);
            return user;
        },
        delete: async (id: string): Promise<boolean> => users.delete(id),
        archive: async (id: string): Promise<{ alreadyArchived: boolean }> => {
            const alreadyArchived = archivedUsers.has(id);
            archivedUsers.add(id);
            return {
                alreadyArchived,
            };
        },
    },
    sessions: {
        findByToken: async (token: string): Promise<{ userId: string } | null> => sessions.get(token) ?? null,
    },
    memberships: {
        findByApiKey: async (apiKey: string): Promise<{ workspaceUserId: string; role: 'owner' | 'admin' } | null> =>
            memberships.get(apiKey) ?? null,
    },
    invites: {
        findByToken: async (token: string): Promise<Invite | null> => invites.get(token) ?? null,
    },
};
