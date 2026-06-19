import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createModel } from './model.js';
import { readMetaId, readMetaDescription } from './generator.js';

describe('createModel', () => {
    it('sets the meta id from title', () => {
        const User = createModel({
            title: 'User',
            schema: z.object({
                id: z.string(),
                name: z.string(),
            }),
        });
        expect(readMetaId(User)).toBe('User');
    });

    it('sets the meta description', () => {
        const User = createModel({
            title: 'User',
            description: 'A user in the system',
            schema: z.object({
                id: z.string(),
            }),
        });
        expect(readMetaDescription(User)).toBe('A user in the system');
    });

    it('works without description', () => {
        const EventKind = createModel({
            title: 'EventKind',
            schema: z.enum(['login', 'logout', 'signup']),
        });
        expect(readMetaId(EventKind)).toBe('EventKind');
        expect(readMetaDescription(EventKind)).toBeUndefined();
    });

    it('works with enum schemas', () => {
        const Status = createModel({
            title: 'Status',
            schema: z.enum(['active', 'inactive']),
        });
        expect(readMetaId(Status)).toBe('Status');
        expect(Status.safeParse('active').success).toBe(true);
        expect(Status.safeParse('invalid').success).toBe(false);
    });

    it('works with discriminated union schemas', () => {
        const Email = z.object({
            channel: z.literal('email'),
            to: z.string(),
        });
        const Sms = z.object({
            channel: z.literal('sms'),
            phone: z.string(),
        });
        const Notification = createModel({
            title: 'Notification',
            schema: z.discriminatedUnion('channel', [Email, Sms]),
        });
        expect(readMetaId(Notification)).toBe('Notification');
        expect(
            Notification.safeParse({
                channel: 'email',
                to: 'test@example.com',
            }).success
        ).toBe(true);
    });

    it('returns a schema usable in routes', () => {
        const User = createModel({
            title: 'User',
            schema: z.object({
                id: z.string(),
            }),
        });
        const result = User.safeParse({
            id: '123',
        });
        expect(result.success).toBe(true);
    });
});
