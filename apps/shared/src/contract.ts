import { createContract, createModel, createTag } from '@ts-kizuna/core';
import { ProblemDetailsSchema } from '@ts-kizuna/core/schemas';
import { z } from 'zod';

export const UserSchema = createModel({
    title: 'User',
    description: 'A user in the system',
    schema: z.object({
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
    }),
});

export type User = z.infer<typeof UserSchema>;

export const CreateUserSchema = createModel({
    title: 'CreateUserInput',
    schema: z.object({
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
    }),
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

export const EmailEvent = createModel({
    title: 'EmailEvent',
    schema: z.object({
        channel: z.literal('email'),
        to: z.email(),
        subject: z.string(),
    }),
});

export const SmsEvent = createModel({
    title: 'SmsEvent',
    schema: z.object({
        channel: z.literal('sms'),
        phone: z.string(),
        text: z.string(),
    }),
});

export const NotificationEvent = createModel({
    title: 'NotificationEvent',
    schema: z.discriminatedUnion('channel', [EmailEvent, SmsEvent]),
});

export const EventKind = createModel({
    title: 'EventKind',
    schema: z.enum(['login', 'logout', 'signup']),
});

export const EventRecord = createModel({
    title: 'EventRecord',
    schema: z.object({
        id: z.string(),
        kind: EventKind,
        occurredAt: z.iso.datetime(),
        userId: z.string(),
    }),
});

const Health = createTag({
    title: 'Health',
    description: 'Service health and uptime monitoring',
});

const Users = createTag({
    title: 'Users',
    description: 'User management endpoints',
});

const Notifications = createTag({
    title: 'Notifications',
});

const healthContract = createContract(Health, {
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

const usersContract = createContract(Users, {
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
            404: ProblemDetailsSchema,
        },
        summary: 'Get a user by id',
    },
    createUser: {
        method: 'POST',
        path: '/users',
        body: CreateUserSchema,
        responses: {
            201: UserSchema,
            400: ProblemDetailsSchema,
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
            404: ProblemDetailsSchema,
        },
        summary: 'Delete a user',
    },
    archiveUser: {
        method: 'POST',
        path: '/users/:id/archive',
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
    getMyWork: {
        method: 'GET',
        path: '/work',
        responses: {
            200: z.object({
                items: z.array(z.string()),
            }),
            204: z.void(),
        },
        summary: 'List work items — exercises a z.void() arm in a multi-status success union',
    },
    checkUser: {
        method: 'HEAD',
        path: '/users/:id/check',
        responses: {
            200: z.object({
                exists: z.boolean(),
            }),
            404: ProblemDetailsSchema,
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

const Members = createTag({
    title: 'Members',
});

const Workspace = createTag({
    title: 'Workspace',
});

export const workspaceContract = createContract({
    members: createContract(Members, {
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
                409: ProblemDetailsSchema,
            },
            summary: 'Invite a member to the workspace',
        },
    }),
    info: createContract(Workspace, {
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
        tags: [Notifications, Health],
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
            400: ProblemDetailsSchema,
            401: z.void(),
        },
        summary: 'Validate config — exercises generator bug coverage',
    },
    health: healthContract,
    webhook: {
        method: 'POST',
        path: '/webhook',
        body: z.any(),
        responses: {
            200: z.object({
                received: z.boolean(),
            }),
        },
        summary: 'Receive arbitrary webhook payload — exercises z.any() / AnyCodable codegen',
    },
});
