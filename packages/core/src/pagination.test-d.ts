import { expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { createPagination } from './pagination.js';

const UserSchema = z.object({
    id: z.string(),
    name: z.string(),
});
type User = z.infer<typeof UserSchema>;

test('query infers page and perPage', () => {
    const pagination = createPagination();
    expectTypeOf<z.infer<typeof pagination.query>>().toEqualTypeOf<{
        page: number;
        perPage: number;
    }>();
});

test('of infers the item type and metadata envelope', () => {
    const pagination = createPagination();
    const response = pagination.of(UserSchema);
    expectTypeOf<z.infer<typeof response>>().toEqualTypeOf<{
        items: User[];
        totalItems: number;
        page: number;
        perPage: number;
        totalPages: number;
        hasNextPage: boolean;
        hasPreviousPage: boolean;
    }>();
});

test('snake casing flows into the inferred query and envelope', () => {
    const pagination = createPagination('snake_case');
    const response = pagination.of(UserSchema);
    expectTypeOf<z.infer<typeof pagination.query>>().toEqualTypeOf<{
        page: number;
        per_page: number;
    }>();
    expectTypeOf<z.infer<typeof response>>().toEqualTypeOf<{
        items: User[];
        total_items: number;
        page: number;
        per_page: number;
        total_pages: number;
        has_next_page: boolean;
        has_previous_page: boolean;
    }>();
});
