import { Kizuna } from '@ts-kizuna/core';
import { ProblemDetailsSchema } from '@ts-kizuna/core/schemas';
import { z } from 'zod';
import { k } from '../k';

export const EmailEvent = Kizuna.model({
    title: 'EmailEvent',
    schema: z.object({
        channel: z.literal('email'),
        to: z.email(),
        subject: z.string(),
    }),
});

export const SmsEvent = Kizuna.model({
    title: 'SmsEvent',
    schema: z.object({
        channel: z.literal('sms'),
        phone: z.string(),
        text: z.string(),
    }),
});

export const NotificationEvent = Kizuna.model({
    title: 'NotificationEvent',
    schema: z.discriminatedUnion('channel', [EmailEvent, SmsEvent]),
});

export const UserSessionEvent = Kizuna.model({
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

export const EventKind = Kizuna.model({
    title: 'EventKind',
    schema: z.enum(['login', 'logout', 'signup']),
});

export const EventRecord = Kizuna.model({
    title: 'EventRecord',
    schema: z.object({
        id: z.string(),
        kind: EventKind,
        occurredAt: z.iso.datetime(),
        userId: z.string(),
    }),
});

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
                description: 'Lower bound for occurredAt, wire format is ISO-8601',
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
                    description: 'Arbitrary label, exercises z.string().transform()',
                }),
            tagIds: z
                .union([z.array(z.string()), z.string().transform((id) => [id])])
                .optional()
                .meta({
                    description: 'One or many tag IDs, exercises non-discriminated union codegen',
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
        summary: 'List events, exercises Date / enum / array query params',
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
        summary: 'Validate contract, exercises generator bug coverage',
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
        summary: 'Receive arbitrary webhook payload, exercises z.any() / AnyCodable codegen',
    },
});
