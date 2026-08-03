import { randomUUID } from 'node:crypto';
import { db } from '@ts-kizuna-demo/shared';
import { toCsv } from '@ts-kizuna-demo/shared/csv';
import { server } from './server';
import { withEventMeta } from '@ts-kizuna/core';

export const router = server.router({
    users: {
        listUsers: async ({ query }) => {
            const skip = (query.page - 1) * query.limit;
            const [users, total] = await Promise.all([db.users.findMany({ skip, take: query.limit }), db.users.count()]);
            return {
                status: 200,
                body: {
                    users,
                    total,
                },
            };
        },
        exportUsers: async () => {
            const users = await db.users.findMany();
            const rows = users.map((user) => [user.id, user.name, user.email]);
            return {
                status: 200,
                body: toCsv(['id', 'name', 'email'], rows),
            };
        },
        userBadge: async ({ params }) => {
            const user = await db.users.findById(params.id);
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
        streamUserActivity: async ({ params, signal, lastEventId }) => {
            const user = await db.users.findById(params.id);
            if (!user) {
                return {
                    status: 404,
                    body: {
                        detail: 'User not found',
                    },
                };
            }
            // An SSE client that reconnects sends the last id it saw, so the feed resumes instead of restarting.
            const resumeFrom = lastEventId ? Number(lastEventId) : 0;
            return {
                status: 200,
                stream: async function* () {
                    yield {
                        type: 'started',
                        userId: user.id,
                    };
                    for (let percent = resumeFrom + 25; percent <= 100; percent += 25) {
                        if (signal.aborted) return;
                        yield withEventMeta(
                            {
                                type: 'progress',
                                percent,
                            },
                            {
                                id: String(percent),
                            }
                        );
                    }
                    yield {
                        type: 'completed',
                        total: await db.users.count(),
                    };
                },
            };
        },
        searchUsers: async ({ query }) => {
            const { users, nextCursor } = await db.users.search(query.q, {
                cursor: query.cursor,
                limit: query.limit,
            });
            return {
                status: 200,
                body: {
                    users,
                    nextCursor,
                },
            };
        },
        getUser: async ({ params, headers }) => {
            const user = await db.users.findById(params.id);
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
        createUser: async ({ body }) => {
            const user = await db.users.create({
                id: randomUUID(),
                name: body.name,
                email: body.email,
                last_name: body.last_name,
            });
            return {
                status: 201,
                body: user,
            };
        },
        deleteUser: async ({ params }) => {
            const existed = await db.users.delete(params.id);
            if (!existed) {
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
                    success: true,
                },
            };
        },
        archiveUser: async ({ params }) => {
            const { alreadyArchived } = await db.users.archive(params.id);
            if (alreadyArchived) {
                return {
                    status: 200,
                    body: {
                        alreadyArchived: true,
                        userId: params.id,
                    },
                };
            }
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
        checkUser: async ({ params }) => {
            const user = await db.users.findById(params.id);
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
        listMembers: async ({ auth }) => {
            const allMembers = await db.users.findMany();
            return {
                status: 200,
                body: {
                    members: allMembers.filter((candidate) => candidate.id !== auth.user.userId),
                },
            };
        },
        inviteMember: async ({ body, auth }) => {
            const existingMember = await db.users.findByEmail(body.email);
            if (existingMember) {
                return {
                    status: 409,
                    body: {
                        detail: `${body.email} is already a member (invite attempted by ${auth.member.role}).`,
                    },
                };
            }
            const invited = await db.users.create({
                id: randomUUID(),
                name: body.email,
                email: body.email,
            });
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
                name: 'Demo Workspace',
            },
        }),
        deleteWorkspace: ({ auth }) => ({
            status: 200,
            body: {
                ok: auth.member.role === 'owner',
            },
        }),
        transfer: async ({ body, auth }) => {
            if (body.toUserId === auth.member.workspaceUserId) {
                return {
                    status: 200,
                    body: {
                        ok: false,
                    },
                };
            }
            await db.users.delete(body.toUserId);
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
                email: auth.inviteToken.email,
            },
        }),
        acceptInvite: ({ auth }) => ({
            status: 201,
            body: {
                userId: `usr_${auth.inviteToken.inviteId}`,
            },
        }),
    },
});
