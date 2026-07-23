import { randomUUID } from 'node:crypto';
import { createServer, type Router } from '@ts-kizuna/next';
import { contract, sessions, memberships, inviteTokens, inviteEmails } from '@ts-kizuna-demo/shared';
import { toCsv } from '@ts-kizuna-demo/shared/csv';

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

const { server } = createServer(contract);

const captureAnalytics = server.requestContext('analytics', ({ request }) => ({
    sessionId: request.headers.get('x-posthog-session-id'),
    distinctId: request.headers.get('x-posthog-distinct-id'),
}));

const requireUser = server.guard('user', ({ bearer, deny }) => {
    const session = bearer ? sessions.get(bearer.token) : undefined;
    if (!session) {
        return deny(401, 'Unauthorized');
    }
    return {
        userId: session.userId,
    };
});

const requireMember = server.guard('member', ({ apiKey, deny }) => {
    const membership = apiKey ? memberships.get(apiKey.value) : undefined;
    if (!membership) {
        return deny(403, 'Forbidden');
    }
    return membership;
});

const requireInviteToken = server.guard('inviteToken', ({ params, deny }) => {
    const inviteId = params.token ? inviteTokens.get(params.token) : undefined;
    if (!inviteId) {
        return deny(404, 'Not found');
    }
    return {
        inviteId,
    };
});

export const api = server.api({
    guards: {
        user: requireUser,
        member: requireMember,
        inviteToken: requireInviteToken,
    },
    requestContext: {
        analytics: captureAnalytics,
    },
    router: {
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
            uploadAvatar: async ({ body }) => {
                const buffer = await body.file.arrayBuffer();
                return {
                    status: 200,
                    body: {
                        size: buffer.byteLength,
                        userId: body.userId,
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
                body: [
                    {
                        ok: true,
                        checkedAt: new Date().toISOString(),
                    },
                ],
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
            listEvents: ({ query, requestContext }) => {
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
                            sessionId: requestContext.analytics.sessionId,
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
            listMembers: ({ auth }) => ({
                status: 200,
                body: {
                    members: Array.from(users.values()).filter((candidate) => candidate.id !== auth.user.userId),
                },
            }),
            inviteMember: ({ body, auth }) => {
                const existing = Array.from(users.values()).find((candidate) => candidate.email === body.email);
                if (existing) {
                    return {
                        status: 409,
                        body: {
                            detail: `${body.email} is already a member (invite attempted by ${auth.member.role}).`,
                        },
                    };
                }
                const invited: User = {
                    id: randomUUID(),
                    name: body.email.split('@')[0] ?? body.email,
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
            getWorkspace: ({ auth }) => ({
                status: 200,
                body: {
                    id: auth.member.workspaceUserId,
                    name: 'ts-kizuna workspace',
                },
            }),
            deleteWorkspace: ({ auth }) => ({
                status: 200,
                body: {
                    ok: auth.member.role === 'owner',
                },
            }),
            transfer: ({ body, auth }) => {
                if (body.toUserId === auth.member.workspaceUserId) {
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
        invites: {
            getInvite: ({ auth }) => ({
                status: 200,
                body: {
                    inviteId: auth.inviteToken.inviteId,
                    email: inviteEmails.get(auth.inviteToken.inviteId) ?? 'unknown@example.com',
                },
            }),
            acceptInvite: ({ auth }) => ({
                status: 201,
                body: {
                    userId: `usr_${auth.inviteToken.inviteId}`,
                },
            }),
        },
    } satisfies Router<typeof contract>,
});
