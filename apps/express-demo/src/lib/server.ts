import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { createGuard } from '@ts-kizuna/express';
import type { Router } from '@ts-kizuna/express';
import { contract } from '@ts-kizuna-demo/shared';
import { toCsv } from '@ts-kizuna-demo/shared/csv';

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            userId?: string;
            member?: { workspaceUserId: string; role: 'owner' | 'admin' };
        }
    }
}

interface User {
    id: string;
    name: string;
    email: string;
    last_name?: string;
}

const users = new Map<string, User>();
users.set('1', {
    id: '1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    last_name: 'Lovelace',
});
users.set('2', {
    id: '2',
    name: 'Linus Torvalds',
    email: 'linus@example.com',
});

const archivedUsers = new Set<string>();

const sessions = new Map<string, { userId: string }>([
    ['tok_ada', { userId: '1' }],
    ['tok_linus', { userId: '2' }],
]);

const memberships = new Map<string, { workspaceUserId: string; role: 'owner' | 'admin' }>([
    ['wst_owner', { workspaceUserId: '1', role: 'owner' }],
    ['wst_admin', { workspaceUserId: '2', role: 'admin' }],
]);

const bearerToken = (req: { headers: Record<string, unknown> }): string | undefined => {
    const header = req.headers['authorization'];
    const value = Array.isArray(header) ? header[0] : header;
    return typeof value === 'string' ? /^bearer\s+(.+)$/i.exec(value)?.[1] : undefined;
};

export const requireUser: RequestHandler = createGuard(({ req, deny }) => {
    const session = sessions.get(bearerToken(req) ?? '');
    if (!session) {
        return deny(401, 'Unauthorized');
    }
    req.userId = session.userId;
});

export const requireMember: RequestHandler = createGuard(({ req, deny }) => {
    const token = req.headers['x-workspace-token'];
    const value = Array.isArray(token) ? token[0] : token;
    const membership = typeof value === 'string' ? memberships.get(value) : undefined;
    if (!membership) {
        return deny(403, 'Forbidden');
    }
    req.member = membership;
});

export const router: Router<typeof contract> = {
    users: {
        listUsers: ({ query }) => {
            const all = Array.from(users.values());
            const start = (query.page - 1) * query.limit;
            return {
                status: 200,
                body: {
                    users: all.slice(start, start + query.limit),
                    total: all.length,
                },
            };
        },
        exportUsers: () => {
            const rows = Array.from(users.values()).map((user) => [user.id, user.name, user.email]);
            return {
                status: 200,
                body: toCsv(['id', 'name', 'email'], rows),
            };
        },
        userBadge: ({ params }) => {
            const user = users.get(params.id);
            if (!user) {
                return {
                    status: 404,
                    body: {
                        detail: 'User not found',
                    },
                };
            }
            return {
                status: 200,
                body: Buffer.from(`BADGE:${user.id}:${user.name}`, 'utf-8'),
            };
        },
        searchUsers: ({ query }) => {
            const all = Array.from(users.values()).filter((user) => user.name.toLowerCase().includes(query.q.toLowerCase()));
            const slice = all.slice(query.cursor, query.cursor + query.limit);
            const nextCursor = query.cursor + slice.length < all.length ? query.cursor + slice.length : null;
            return {
                status: 200,
                body: {
                    users: slice,
                    nextCursor,
                },
            };
        },
        getUser: ({ params, headers }) => {
            const user = users.get(params.id);
            if (!user) {
                return {
                    status: 404,
                    body: {
                        detail: 'User not found',
                    },
                };
            }
            return {
                status: 200,
                body: user,
                headers: {
                    'x-request-id': headers['x-request-id'],
                },
            };
        },
        createUser: ({ body }) => {
            const user: User = {
                id: randomUUID(),
                name: body.name,
                email: body.email,
                last_name: body.last_name,
            };
            users.set(user.id, user);
            return {
                status: 201,
                body: user,
            };
        },
        deleteUser: ({ params }) => {
            if (!users.has(params.id)) {
                return {
                    status: 404,
                    body: {
                        detail: 'User not found',
                    },
                };
            }
            users.delete(params.id);
            return {
                status: 200,
                body: {
                    success: true,
                },
            };
        },
        archiveUser: ({ params }) => {
            if (archivedUsers.has(params.id)) {
                return {
                    status: 200,
                    body: {
                        alreadyArchived: true,
                        userId: params.id,
                    },
                };
            }
            archivedUsers.add(params.id);
            return {
                status: 201,
                body: {
                    archivedAt: new Date().toISOString(),
                    userId: params.id,
                },
            };
        },
        uploadAvatar: () => {
            // Multipart is out of scope for the Express adapter today — see CLAUDE.md.
            // Real consumers wire multer (or similar) before this handler runs.
            return {
                status: 200,
                body: {
                    size: 0,
                    userId: 'unsupported',
                },
            };
        },
        pingUser: () => ({
            status: 204,
            body: undefined,
        }),
        getMyWork: () => ({
            status: 200,
            body: {
                items: ['draft report', 'review pull request'],
                contentType: 'image/jpeg',
            },
        }),
        checkUser: ({ params }) => {
            const user = users.get(params.id);
            if (!user) {
                return {
                    status: 404,
                    body: {
                        detail: 'User not found',
                    },
                };
            }
            return {
                status: 200,
                body: {
                    exists: true,
                },
            };
        },
        describeUsers: () => ({
            status: 200,
            body: {
                allow: 'GET, HEAD, POST, OPTIONS',
            },
        }),
    },
    health: {
        check: () => ({
            status: 200,
            body: {
                ok: true,
            },
        }),
        version: () => ({
            status: 200,
            body: {
                version: '1.0.0',
            },
        }),
        history: () => ({
            status: 200,
            body: [{ ok: true, checkedAt: new Date().toISOString() }],
        }),
    },
    notifications: {
        sendNotification: () => {
            return {
                status: 202,
                body: {
                    accepted: true,
                },
            };
        },
        listEvents: ({ query }) => {
            return {
                status: 200,
                body: {
                    events: [
                        {
                            id: 'evt_1',
                            kind: 'login',
                            occurredAt: '2026-04-01T10:00:00.000Z',
                            userId: '1',
                        },
                    ],
                    echo: {
                        since: query.since ? query.since.toISOString() : null,
                        kind: query.kind ?? null,
                        ids: query.ids ?? null,
                        label: query.label ?? null,
                        tagIds: query.tagIds ?? null,
                    },
                },
            };
        },
        validateConfig: () => ({
            status: 200,
            body: {
                status: 'ok',
            },
        }),
        webhook: () => ({
            status: 200,
            body: {
                received: true,
            },
        }),
    },
    members: {
        listMembers: ({ req }) => ({
            status: 200,
            body: {
                members: Array.from(users.values()).filter((candidate) => candidate.id !== req.userId),
            },
        }),
        inviteMember: ({ body, req }) => {
            const existing = Array.from(users.values()).find((candidate) => candidate.email === body.email);
            if (existing) {
                return {
                    status: 409,
                    body: {
                        detail: `${body.email} is already a member (invite attempted by ${req.member?.role}).`,
                    },
                };
            }
            const invited: User = {
                id: randomUUID(),
                name: body.email,
                email: body.email,
            };
            users.set(invited.id, invited);
            return {
                status: 201,
                body: invited,
            };
        },
    },
    workspace: {
        getWorkspace: ({ req }) => ({
            status: 200,
            body: {
                id: req.member?.workspaceUserId ?? '',
                name: 'ts-kizuna demo workspace',
            },
        }),
        deleteWorkspace: ({ req }) => ({
            status: 200,
            body: {
                ok: req.member?.role === 'owner',
            },
        }),
        transfer: ({ body, req }) => {
            if (body.toUserId === req.userId || req.member?.role !== 'owner') {
                return {
                    status: 200,
                    body: {
                        ok: false,
                    },
                };
            }
            users.delete(body.toUserId);
            return {
                status: 200,
                body: {
                    ok: true,
                },
            };
        },
    },
};
