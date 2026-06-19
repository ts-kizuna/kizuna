import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createPagination } from './pagination.js';

const UserSchema = z.object({
    id: z.string(),
    name: z.string(),
});

const CAMEL_ENVELOPE = ['items', 'totalItems', 'page', 'perPage', 'totalPages', 'hasNextPage', 'hasPreviousPage'];
const SNAKE_ENVELOPE = ['items', 'total_items', 'page', 'per_page', 'total_pages', 'has_next_page', 'has_previous_page'];

describe('createPagination query', () => {
    it('exposes page and perPage', () => {
        const pagination = createPagination();
        expect(Object.keys(pagination.query.shape)).toEqual(['page', 'perPage']);
    });

    it('defaults to page 1 with a perPage of 10', () => {
        const pagination = createPagination();
        expect(pagination.query.parse({})).toEqual({
            page: 1,
            perPage: 10,
        });
    });

    it('rejects a page below 1 and a perPage below 1', () => {
        const pagination = createPagination();
        expect(pagination.query.safeParse({ page: 0 }).success).toBe(false);
        expect(pagination.query.safeParse({ perPage: 0 }).success).toBe(false);
    });

    it('extends with extra params', () => {
        const pagination = createPagination();
        const query = pagination.query.extend({
            sortBy: z.enum(['name', 'id']).optional(),
        });
        expect(Object.keys(query.shape)).toEqual(['page', 'perPage', 'sortBy']);
    });
});

describe('createPagination of', () => {
    it('wraps items with the page metadata envelope', () => {
        const pagination = createPagination();
        expect(Object.keys(pagination.of(UserSchema).shape)).toEqual(CAMEL_ENVELOPE);
    });

    it('parses a valid page payload', () => {
        const pagination = createPagination();
        const result = pagination.of(UserSchema).safeParse({
            items: [{ id: '1', name: 'Ada' }],
            totalItems: 1,
            page: 1,
            perPage: 10,
            totalPages: 1,
            hasNextPage: false,
            hasPreviousPage: false,
        });
        expect(result.success).toBe(true);
    });

    it('extends the envelope with extra metadata', () => {
        const pagination = createPagination();
        const schema = pagination.of(UserSchema).extend({
            facets: z.array(z.string()),
        });
        expect(Object.keys(schema.shape)).toEqual([...CAMEL_ENVELOPE, 'facets']);
    });
});

describe('createPagination casing', () => {
    it('casts the query and envelope to snake_case', () => {
        const pagination = createPagination('snake_case');
        expect(Object.keys(pagination.query.shape)).toEqual(['page', 'per_page']);
        expect(Object.keys(pagination.of(UserSchema).shape)).toEqual(SNAKE_ENVELOPE);
    });

    it('reuses one config across different item types', () => {
        const pagination = createPagination();
        const OrderSchema = z.object({ id: z.string() });
        expect(Object.keys(pagination.of(UserSchema).shape)).toEqual(Object.keys(pagination.of(OrderSchema).shape));
    });
});
