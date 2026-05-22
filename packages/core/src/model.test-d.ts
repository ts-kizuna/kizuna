import { expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { createModel } from './model.js';

test('createModel preserves object schema type', () => {
    const User = createModel({
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

test('createModel preserves enum schema type', () => {
    const EventKind = createModel({
        title: 'EventKind',
        schema: z.enum(['login', 'logout', 'signup']),
    });
    expectTypeOf<z.infer<typeof EventKind>>().toEqualTypeOf<'login' | 'logout' | 'signup'>();
});

test('createModel preserves optional fields', () => {
    const User = createModel({
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

test('createModel result is assignable to z.ZodType', () => {
    const User = createModel({
        title: 'User',
        schema: z.object({
            id: z.string(),
        }),
    });
    expectTypeOf(User).toMatchTypeOf<z.ZodType>();
});

test('createModel result is usable in z.array', () => {
    const User = createModel({
        title: 'User',
        schema: z.object({
            id: z.string(),
        }),
    });
    const Users = z.array(User);
    expectTypeOf<z.infer<typeof Users>>().toEqualTypeOf<Array<{ id: string }>>();
});
