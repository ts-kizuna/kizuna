import { randomUUID } from 'node:crypto';
import { db } from '@ts-kizuna-demo/shared';
import { toCsv } from '@ts-kizuna-demo/shared/csv';
import type { Router } from '@ts-kizuna/fastify';
import type { contract } from '@ts-kizuna-demo/shared';

export const users: Router<typeof contract.routes.users> = {
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
    lastSessionEvent: async ({ params }) => {
        const event = await db.sessions.findLastEventByUserId(params.id);
        if (!event) {
            return {
                status: 404,
                body: {
                    detail: 'No session events for this user',
                },
            };
        }
        return {
            status: 200,
            body: event,
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
    userActivity: async ({ params }) => {
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
                userId: user.id,
                year: params.year,
                events: params.year - 2000,
            },
        };
    },
    createUser: async ({ body, jobs }) => {
        const user = await db.users.create({
            id: randomUUID(),
            name: body.name,
            email: body.email,
            last_name: body.last_name,
        });
        await jobs.users.indexUser.queue({
            input: {
                userId: user.id,
            },
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
    scheduleUserExport: ({ params, body }) => ({
        status: 201,
        body: {
            scheduledFor: new Date(body.startAfter.getTime() + 60_000),
            estimatedBytes: 8_589_934_592n,
            statusUrl: new URL(`https://api.example.com/users/${params.id}/exports/next`),
        },
    }),
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
};
