import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { isPermission } from './permission.js';
import { Kizuna } from './kizuna.js';

const UserSchema = z.object({
    id: z.string(),
});

describe('Kizuna.permission', () => {
    it('declares a plain yes or no', () => {
        const viewInvoices = Kizuna.permission({
            description: 'See the workspace invoices',
        });

        expect(viewInvoices.__brand).toBe('Permission');
        expect(viewInvoices.appliesTo).toBeUndefined();
        expect(viewInvoices.description).toBe('See the workspace invoices');
    });

    it('takes no config at all', () => {
        expect(Kizuna.permission().appliesTo).toBeUndefined();
    });

    it('carries the record it applies to', () => {
        const promoteMember = Kizuna.permission({
            appliesTo: UserSchema,
        });

        expect(promoteMember.appliesTo).toBe(UserSchema);
    });
});

describe('isPermission', () => {
    it('accepts a permission', () => {
        expect(isPermission(Kizuna.permission())).toBe(true);
    });

    it('rejects an identity, a plain object, and nothing', () => {
        expect(
            isPermission(
                Kizuna.identity.bearer({
                    context: z.object({
                        userId: z.string(),
                    }),
                })
            )
        ).toBe(false);
        expect(isPermission({ appliesTo: UserSchema })).toBe(false);
        expect(isPermission(null)).toBe(false);
        expect(isPermission(undefined)).toBe(false);
    });
});
