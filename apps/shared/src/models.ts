import { Kizuna } from '@ts-kizuna/core';
import { z } from 'zod';

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
