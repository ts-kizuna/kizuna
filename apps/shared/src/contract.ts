import { createContract } from '@ts-kizuna/core';
import { z } from 'zod';

export const UserSchema = z
    .object({
        id: z.string().meta({
            description: 'Unique user identifier',
            example: 'usr_abc123',
        }),
        name: z.string().meta({
            description: 'Display name',
            example: 'Alice Johnson',
        }),
        /**
         * @deprecated use `email_address` instead.
         */
        email: z.email().meta({
            description: 'Email address',
            example: 'alice@example.com',
        }),
        email_address: z.email().optional().meta({
            description: 'Email address',
            example: 'alice@example.com',
        }),
        last_name: z.string().optional().meta({
            description: 'Family name on the wire as `last_name` — exercises snake_case fidelity through the generators.',
            example: 'Hopper',
        }),
    })
    .meta({
        id: 'User',
        description: 'A user in the system',
    });

export type User = z.infer<typeof UserSchema>;

export const CreateUserSchema = z
    .object({
        name: z.string().min(1).meta({
            description: 'Display name',
            example: 'Alice Johnson',
        }),
        email: z.email().meta({
            description: 'Email address',
            example: 'alice@example.com',
        }),
        last_name: z.string().optional().meta({
            description: 'Family name. Snake_case wire key, kept verbatim by both clients.',
            example: 'Hopper',
        }),
    })
    .meta({
        id: 'CreateUserInput',
    });

export type CreateUserInput = z.infer<typeof CreateUserSchema>;

const PaginationQuery = z.object({
    page: z.coerce.number().int().min(1).default(1).meta({
        description: 'Page number, starting at 1',
        example: 1,
    }),
    limit: z.coerce.number().int().min(1).max(100).default(10).meta({
        description: 'Page size (1–100)',
        example: 10,
    }),
});

export const EmailEvent = z
    .object({
        channel: z.literal('email'),
        to: z.email(),
        subject: z.string(),
    })
    .meta({
        id: 'EmailEvent',
    });

export const SmsEvent = z
    .object({
        channel: z.literal('sms'),
        phone: z.string(),
        text: z.string(),
    })
    .meta({
        id: 'SmsEvent',
    });

export const NotificationEvent = z.discriminatedUnion('channel', [EmailEvent, SmsEvent]).meta({
    id: 'NotificationEvent',
});

export const EventKind = z.enum(['login', 'logout', 'signup']).meta({
    id: 'EventKind',
});

export const EventRecord = z
    .object({
        id: z.string(),
        kind: EventKind,
        occurredAt: z.iso.datetime(),
        userId: z.string(),
    })
    .meta({
        id: 'EventRecord',
    });

const healthContract = createContract('Health', {
    check: {
        method: 'GET',
        path: '/health',
        responses: {
            200: z.object({ ok: z.boolean() }),
        },
        summary: 'Health check — exercises nested sub-client routing',
    },
    version: {
        method: 'GET',
        path: '/health/version',
        responses: {
            200: z.object({ version: z.string() }),
        },
        summary: 'Version — exercises second method in a sub-client group',
    },
    history: {
        method: 'GET',
        path: '/health/history',
        responses: {
            200: z.array(z.object({ ok: z.boolean(), checkedAt: z.iso.datetime() })),
        },
        summary: 'Health history — exercises array return type qualification',
    },
});

const usersContract = createContract('Users', {
    listUsers: {
        method: 'GET',
        path: '/users',
        query: PaginationQuery,
        responses: {
            200: z.object({
                users: z.array(UserSchema),
                total: z.number(),
            }),
        },
        summary: 'List users with pagination',
    },
    searchUsers: {
        method: 'GET',
        path: '/users/search',
        query: z.object({
            q: z.string(),
            limit: z.coerce.number().int().min(1).max(100),
            cursor: z.coerce.number().int().min(0),
        }),
        responses: {
            200: z.object({
                users: z.array(UserSchema),
                nextCursor: z.number().nullable(),
            }),
        },
        summary: 'Search users — required coerced limit and cursor',
    },
    getUser: {
        method: 'GET',
        path: '/users/:id',
        headers: z.object({
            'x-request-id': z.string(),
        }),
        responses: {
            200: {
                body: UserSchema,
                headers: z.object({
                    'x-request-id': z.string().optional(),
                }),
            },
            404: z.object({
                message: z.string(),
            }),
        },
        summary: 'Get a user by id',
    },
    createUser: {
        method: 'POST',
        path: '/users',
        body: CreateUserSchema,
        responses: {
            201: UserSchema,
            400: z.object({
                message: z.string(),
            }),
        },
        summary: 'Create a user',
    },
    /**
     * @deprecated
     */
    deleteUser: {
        method: 'DELETE',
        path: '/users/:id',
        responses: {
            200: z.object({
                success: z.boolean(),
            }),
            404: z.object({
                message: z.string(),
            }),
        },
        summary: 'Delete a user',
    },
    archiveUser: {
        method: 'POST',
        path: '/users/:id/archive',
        body: z.object({}),
        responses: {
            200: z.object({
                alreadyArchived: z.literal(true),
                userId: z.string(),
            }),
            201: z.object({
                archivedAt: z.iso.datetime(),
                userId: z.string(),
            }),
        },
        summary: 'Archive a user — first call returns 201, subsequent calls 200',
    },
    uploadAvatar: {
        method: 'POST',
        path: '/avatar',
        contentType: 'multipart/form-data',
        body: z.object({
            file: z.instanceof(File),
            userId: z.string(),
        }),
        responses: {
            200: z.object({
                size: z.number(),
                userId: z.string(),
            }),
        },
        summary: 'Upload an avatar image',
    },
    pingUser: {
        method: 'POST',
        path: '/users/:id/ping',
        body: z.void(),
        responses: {
            204: z.void(),
        },
        summary: 'Ping a user — exercises z.void() body and response',
    },
    checkUser: {
        method: 'HEAD',
        path: '/users/:id/check',
        responses: {
            200: z.object({
                exists: z.boolean(),
            }),
            404: z.void(),
        },
        summary: 'Check user existence — exercises HEAD body stripping',
    },
    describeUsers: {
        method: 'OPTIONS',
        path: '/users/describe',
        responses: {
            200: z.object({
                allow: z.string(),
            }),
        },
        summary: 'Describe allowed operations — exercises OPTIONS routing',
    },
});

export const workspaceContract = createContract({
    members: createContract('Members', {
        listMembers: {
            method: 'GET',
            path: '/workspace/members',
            responses: {
                200: z.object({
                    members: z.array(UserSchema),
                }),
            },
            summary: 'List workspace members',
        },
        inviteMember: {
            method: 'POST',
            path: '/workspace/members',
            body: z.object({
                email: z.email(),
            }),
            responses: {
                201: UserSchema,
                409: z.object({
                    message: z.string(),
                }),
            },
            summary: 'Invite a member to the workspace',
        },
    }),
    info: createContract('Workspace', {
        getWorkspace: {
            method: 'GET',
            path: '/workspace',
            responses: {
                200: z.object({
                    id: z.string(),
                    name: z.string(),
                }),
            },
            summary: 'Get workspace info',
        },
    }),
});

export const contract = createContract({
    users: usersContract,
    sendNotification: {
        method: 'POST',
        path: '/notifications',
        tags: ['Notifications', 'Health'],
        body: NotificationEvent,
        responses: {
            202: z.object({
                accepted: z.boolean(),
            }),
        },
        summary: 'Send a notification (discriminated by channel)',
    },
    listEvents: {
        method: 'GET',
        path: '/events',
        query: z.object({
            since: z.coerce.date().optional().meta({
                description: 'Lower bound for occurredAt — wire format is ISO-8601',
            }),
            kind: EventKind.optional(),
            ids: z.array(z.string()).optional().meta({
                description: 'Filter by id; repeated query param',
            }),
            label: z
                .string()
                .transform((value) => value.trim())
                .optional()
                .meta({
                    description: 'Arbitrary label — exercises z.string().transform()',
                }),
            tagIds: z
                .union([z.array(z.string()), z.string().transform((id) => [id])])
                .optional()
                .meta({
                    description: 'One or many tag IDs — exercises non-discriminated union codegen',
                }),
        }),
        responses: {
            200: z.object({
                events: z.array(EventRecord),
                echo: z.object({
                    since: z.iso.datetime().nullable(),
                    kind: EventKind.nullable(),
                    ids: z.array(z.string()).nullable(),
                    label: z.string().nullable(),
                    tagIds: z.array(z.string()).nullable(),
                }),
            }),
        },
        summary: 'List events — exercises Date / enum / array query params',
    },
    validateConfig: {
        method: 'POST',
        path: '/config/validate',
        body: z.object({
            default: z.string(),
            interval: z.int(),
        }),
        responses: {
            200: z
                .object({
                    status: z.string(),
                })
                .meta({
                    description: 'Validation result',
                }),
            400: z.object({ message: z.string() }).meta({ id: 'Error' }),
            401: z.void(),
        },
        summary: 'Validate config — exercises generator bug coverage',
    },
    health: healthContract,
});
