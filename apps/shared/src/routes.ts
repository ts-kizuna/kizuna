import { createModel } from '@ts-kizuna/core';
import { ProblemDetailsSchema, BinarySchema } from '@ts-kizuna/core/schemas';
import { addCodedIssue } from '@ts-kizuna/core/zod';
import { z } from 'zod';
import { k } from './k.js';
import { PaginationQuery } from './pagination.js';

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
            description: 'Family name on the wire as `last_name`, exercises snake_case fidelity through the generators.',
            example: 'Hopper',
        }),
        avatar: z
            .object({
                id: z.string(),
                url: z.string(),
            })
            .nullable()
            .optional()
            .meta({
                description:
                    'Sibling anonymous objects (`avatar` / `avatars`) exercise inline-object naming where one field name is a prefix of another.',
            }),
        avatars: z
            .array(
                z.object({
                    id: z.string(),
                    url: z.string(),
                })
            )
            .optional(),
    }),
});

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
        /**
         * Optional phone number, validated with a custom-coded issue.
         *
         * On failure it emits `invalid_phone_number` via `addCodedIssue`. The
         * code is declared in `kizuna.contract.ts` and passed to `createClient`,
         * so the client suggests `invalid_phone_number` in autocomplete when
         * reading `errors[].code` on the `400` response.
         */
        phone: z
            .string()
            .optional()
            .superRefine((value, ctx) => {
                if (value === undefined || /^\+?[0-9]{7,15}$/.test(value)) return;
                addCodedIssue(ctx, {
                    code: 'invalid_phone_number',
                    message: 'Phone number must be 7–15 digits, optionally prefixed with +.',
                    input: value,
                });
            })
            .meta({
                description: 'Phone number in E.164-ish form. Demonstrates a custom-coded validation issue.',
                example: '+15551234567',
            }),
    }),
});

export type CreateUserInput = z.infer<typeof CreateUserSchema>;

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

export const UserSessionEvent = createModel({
    title: 'UserSessionEvent',
    schema: z.discriminatedUnion('kind', [
        z.object({
            kind: z.literal('login'),
            at: z.iso.datetime(),
            ipAddress: z.string(),
            userAgent: z.string(),
        }),
        z.object({
            kind: z.literal('logout'),
            at: z.iso.datetime(),
            reason: z.enum(['signed_out', 'session_expired']),
        }),
    ]),
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

export const healthRoutes = k.routes('health', {
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

export const usersRoutes = k.routes('users', {
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
    exportUsers: {
        method: 'GET',
        path: '/users/export',
        responses: {
            200: {
                body: z.string(),
                contentType: 'text/csv',
            },
        },
        summary: 'Export users as CSV — exercises a non-JSON (text/csv) raw response body',
    },
    userBadge: {
        method: 'GET',
        path: '/users/:id/badge',
        responses: {
            200: {
                body: BinarySchema,
                contentType: 'application/octet-stream',
            },
            404: ProblemDetailsSchema,
        },
        summary: 'Download a user badge — exercises a binary (BinarySchema) response body',
    },
    lastSessionEvent: {
        method: 'GET',
        path: '/users/:id/last-session-event',
        responses: {
            200: UserSessionEvent,
            404: ProblemDetailsSchema,
        },
        summary: "A user's most recent login or logout — inline union variants nest under the User model in native clients",
    },
    searchUsers: {
        method: 'GET',
        path: '/users/search',
        query: z.object({
            q: z.string(),
            limit: z.number().int().min(1).max(100),
            cursor: z.number().int().min(0),
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
    userActivity: {
        method: 'GET',
        path: '/users/:id/activity/:year',
        pathParams: z.object({
            id: z.string(),
            year: z.int().min(2000).max(2100),
        }),
        responses: {
            200: z.object({
                userId: z.string(),
                year: z.int(),
                events: z.int(),
            }),
            404: ProblemDetailsSchema,
        },
        summary: 'Get a year of user activity, exercising two typed path params (a string id and a coerced int year)',
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
                contentType: z.enum(['image/jpeg', 'text-plain', 'video.mp4', '3d-model']),
            }),
            204: z.void(),
        },
        summary:
            'List work items — exercises a z.void() arm in a multi-status success union and enum values that are not valid Swift identifiers',
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

const workspaceMembers = k.routes('members', {
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
});

const workspaceInfo = k.routes('workspace', {
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
    deleteWorkspace: {
        method: 'DELETE',
        path: '/workspace',
        responses: {
            200: z.object({
                ok: z.boolean(),
            }),
        },
        summary: 'Delete the workspace — owner-only via the auth map',
    },
    transfer: {
        method: 'POST',
        path: '/workspace/transfer',
        body: z.object({
            toUserId: z.string(),
        }),
        responses: {
            200: z.object({
                ok: z.boolean(),
            }),
        },
        summary: 'Transfer ownership — owner-only via the auth map',
    },
});

export const workspaceRoutes = {
    members: workspaceMembers,
    info: workspaceInfo,
};

export const notificationsRoutes = k.routes('notifications', {
    sendNotification: {
        method: 'POST',
        path: '/notifications',
        tags: ['notifications', 'health'],
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
            since: z.date().optional().meta({
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
                    sessionId: z.string().nullable(),
                }),
            }),
        },
        summary: 'List events — exercises Date / enum / array query params',
    },
    validateConfig: {
        method: 'POST',
        path: '/contract/validate',
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
        summary: 'Validate contract — exercises generator bug coverage',
    },
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

export const inviteRoutes = k.routes('invites', {
    getInvite: {
        method: 'GET',
        path: '/invites/:token',
        responses: {
            200: z.object({
                inviteId: z.string(),
                email: z.email(),
            }),
            404: ProblemDetailsSchema,
        },
        summary: 'Resolve an invite by its capability-URL token, guarded by a custom path-token identity',
    },
    acceptInvite: {
        method: 'POST',
        path: '/invites/:token/accept',
        body: z.object({
            name: z.string(),
        }),
        responses: {
            201: z.object({
                userId: z.string(),
            }),
            404: ProblemDetailsSchema,
        },
        summary: 'Accept an invite via the capability URL',
    },
});

export const routes = {
    users: usersRoutes,
    health: healthRoutes,
    notifications: notificationsRoutes,
    members: workspaceMembers,
    workspace: workspaceInfo,
    invites: inviteRoutes,
};
