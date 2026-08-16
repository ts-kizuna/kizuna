import { expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { Kizuna } from './kizuna.js';

test('Kizuna.model preserves object schema type', () => {
    const User = Kizuna.model({
        title: 'User',
        schema: z.object({
            id: z.string(),
            name: z.string(),
        }),
    });
    expectTypeOf<z.infer<typeof User>>().toEqualTypeOf<{
        id: string;
        name: string;
    }>();
});

test('Kizuna.model preserves enum schema type', () => {
    const EventKind = Kizuna.model({
        title: 'EventKind',
        schema: z.enum(['login', 'logout', 'signup']),
    });
    expectTypeOf<z.infer<typeof EventKind>>().toEqualTypeOf<'login' | 'logout' | 'signup'>();
});

test('Kizuna.model preserves optional fields', () => {
    const User = Kizuna.model({
        title: 'User',
        schema: z.object({
            id: z.string(),
            name: z.string().optional(),
        }),
    });
    expectTypeOf<z.infer<typeof User>>().toEqualTypeOf<{
        id: string;
        name?: string;
    }>();
});

test('Kizuna.model result is assignable to z.ZodType', () => {
    const User = Kizuna.model({
        title: 'User',
        schema: z.object({
            id: z.string(),
        }),
    });
    expectTypeOf(User).toMatchTypeOf<z.ZodType>();
});

test('Kizuna.model result is usable in z.array', () => {
    const User = Kizuna.model({
        title: 'User',
        schema: z.object({
            id: z.string(),
        }),
    });
    const Users = z.array(User);
    expectTypeOf<z.infer<typeof Users>>().toEqualTypeOf<Array<{ id: string }>>();
});
