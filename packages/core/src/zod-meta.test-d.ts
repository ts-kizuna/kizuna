import { test } from 'vitest';
import { z } from 'zod';
import './zod-meta.js';

test('example is typed against the schema output', () => {
    const UserSchema = z.object({
        id: z.string(),
    });
    UserSchema.meta({
        example: {
            id: 'usr_1',
        },
    });
    UserSchema.meta({
        // @ts-expect-error the example must match the schema output
        example: {
            id: 1,
        },
    });
});

test('example accepts an array of the schema output', () => {
    const UserSchema = z.object({
        id: z.string(),
    });
    UserSchema.meta({
        example: [
            {
                id: 'usr_1',
            },
            {
                id: 'usr_2',
            },
        ],
    });
    UserSchema.meta({
        example: [
            {
                // @ts-expect-error each example must match the schema output
                id: 1,
            },
        ],
    });
});

test('deprecated accepts a boolean or a message', () => {
    z.string().meta({
        deprecated: true,
    });
    z.string().meta({
        deprecated: 'use `email_address` instead',
    });
});
