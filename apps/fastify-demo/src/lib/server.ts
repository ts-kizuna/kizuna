import { randomUUID } from 'node:crypto';
import { createRouter } from '@ts-kizuna/fastify';
import { contract } from '@ts-kizuna-demo/shared';
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

export const router = createRouter(contract, {
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
        listUsersPaged: ({ query }) => {
            const all = Array.from(users.values());
            const start = (query.page - 1) * query.perPage;
            const items = all.slice(start, start + query.perPage);
            const totalPages = Math.max(1, Math.ceil(all.length / query.perPage));
            return {
                status: 200,
                body: {
                    items,
                    totalItems: all.length,
                    page: query.page,
                    perPage: query.perPage,
                    totalPages,
                    hasNextPage: query.page < totalPages,
                    hasPreviousPage: query.page > 1,
                },
            };
        },
        listUsersPagedSnake: ({ query }) => {
            const all = Array.from(users.values());
            const start = (query.page - 1) * query.per_page;
            const items = all.slice(start, start + query.per_page);
            const totalPages = Math.max(1, Math.ceil(all.length / query.per_page));
            return {
                status: 200,
                body: {
                    items,
                    total_items: all.length,
                    page: query.page,
                    per_page: query.per_page,
                    total_pages: totalPages,
                    has_next_page: query.page < totalPages,
                    has_previous_page: query.page > 1,
                },
            };
        },
        listUsersSorted: ({ query }) => {
            const all = Array.from(users.values());
            const sortBy = query.sortBy;
            const sorted = sortBy ? [...all].sort((left, right) => left[sortBy].localeCompare(right[sortBy])) : all;
            const start = (query.page - 1) * query.perPage;
            const items = sorted.slice(start, start + query.perPage);
            const totalPages = Math.max(1, Math.ceil(sorted.length / query.perPage));
            return {
                status: 200,
                body: {
                    items,
                    totalItems: sorted.length,
                    page: query.page,
                    perPage: query.perPage,
                    totalPages,
                    hasNextPage: query.page < totalPages,
                    hasPreviousPage: query.page > 1,
                },
            };
        },
        listUsersFaceted: ({ query }) => {
            const all = Array.from(users.values());
            const start = (query.page - 1) * query.perPage;
            const items = all.slice(start, start + query.perPage);
            const totalPages = Math.max(1, Math.ceil(all.length / query.perPage));
            return {
                status: 200,
                body: {
                    items,
                    totalItems: all.length,
                    page: query.page,
                    perPage: query.perPage,
                    totalPages,
                    hasNextPage: query.page < totalPages,
                    hasPreviousPage: query.page > 1,
                    facets: [{ value: 'active', count: all.length }],
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
    sendNotification: () => {
        return {
            status: 202,
            body: {
                accepted: true,
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
});
