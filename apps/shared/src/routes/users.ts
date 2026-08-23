import { Kizuna } from '@ts-kizuna/core';
import { ProblemDetailsSchema, BinarySchema, UrlSchema } from '@ts-kizuna/core/schemas';
import { z } from 'zod';
import { k } from '../k';
import { PaginationQuery } from '../pagination';
import { UserSessionEvent } from './notifications';

export const UserSchema = Kizuna.model({
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
        email: z.email().meta({
            deprecated: 'use `email_address` instead.',
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

export const CreateUserSchema = Kizuna.model({
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
         * On failure it emits `invalid_phone_number` via `k.issue`, which checks
         * the code against the `issueCodes` declared on `new Kizuna()`. The client
         * suggests it in autocomplete when reading `errors[].code` on the `400`
         * response.
         */
        phone: z
            .string()
            .optional()
            .superRefine((value, ctx) => {
                if (value === undefined || /^\+?[0-9]{7,15}$/.test(value)) return;
                k.issue(ctx, {
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
        summary: 'Export users as CSV, exercises a non-JSON (text/csv) raw response body',
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
        summary: 'Download a user badge, exercises a binary (BinarySchema) response body',
    },
    lastSessionEvent: {
        method: 'GET',
        path: '/users/:id/last-session-event',
        responses: {
            200: UserSessionEvent,
            404: ProblemDetailsSchema,
        },
        summary: "A user's most recent login or logout, inline union variants nest under the User model in native clients",
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
        summary: 'Search users, required coerced limit and cursor',
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
    deleteUser: {
        method: 'DELETE',
        path: '/users/:id',
        deprecated: {
            message: 'use `archiveUser` instead',
            date: '2026-03-01',
            link: 'https://example.com/changelog/delete-user',
        },
        sunset: '2027-01-01',
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
        summary: 'Archive a user, first call returns 201, subsequent calls 200',
    },
    scheduleUserExport: {
        method: 'POST',
        path: '/users/:id/exports',
        body: z.object({
            startAfter: z.date(),
            notifyUrl: UrlSchema,
        }),
        responses: {
            201: z.object({
                scheduledFor: z.date(),
                estimatedBytes: z.bigint(),
                statusUrl: UrlSchema,
            }),
        },
        summary: 'Schedule an export of a user, native types in both directions',
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
        summary: 'Ping a user, exercises z.void() body and response',
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
            'List work items, exercises a z.void() arm in a multi-status success union and enum values that are not valid Swift identifiers',
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
        summary: 'Check user existence, exercises HEAD body stripping',
    },
    describeUsers: {
        method: 'OPTIONS',
        path: '/users/describe',
        responses: {
            200: z.object({
                allow: z.string(),
            }),
        },
        summary: 'Describe allowed operations, exercises OPTIONS routing',
    },
});
