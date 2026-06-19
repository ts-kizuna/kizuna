import { z } from 'zod';

/**
 * Field-naming convention for the multi-word fields. `'camelCase'` (the default)
 * emits `perPage`, `totalItems`, `totalPages`, `hasNextPage`, `hasPreviousPage`;
 * `'snake_case'` emits their snake_case equivalents. Set it once on
 * {@link createPagination} and the query and envelope — and their inferred
 * types — follow.
 */
export type PaginationCasing = 'camelCase' | 'snake_case';

type PerPageKey<Casing extends PaginationCasing> = Casing extends 'snake_case' ? 'per_page' : 'perPage';
type TotalItemsKey<Casing extends PaginationCasing> = Casing extends 'snake_case' ? 'total_items' : 'totalItems';
type TotalPagesKey<Casing extends PaginationCasing> = Casing extends 'snake_case' ? 'total_pages' : 'totalPages';
type HasNextKey<Casing extends PaginationCasing> = Casing extends 'snake_case' ? 'has_next_page' : 'hasNextPage';
type HasPrevKey<Casing extends PaginationCasing> = Casing extends 'snake_case' ? 'has_previous_page' : 'hasPreviousPage';

type PaginationQuerySchema<Casing extends PaginationCasing> = z.ZodObject<
    { page: z.ZodDefault<z.ZodNumber> } & Record<PerPageKey<Casing>, z.ZodDefault<z.ZodNumber>>
>;

type PaginatedSchema<Item extends z.ZodType, Casing extends PaginationCasing> = z.ZodObject<
    { items: z.ZodArray<Item> } & Record<TotalItemsKey<Casing>, z.ZodNumber> & { page: z.ZodNumber } & Record<
            PerPageKey<Casing>,
            z.ZodNumber
        > & Record<TotalPagesKey<Casing>, z.ZodNumber> &
        Record<HasNextKey<Casing>, z.ZodBoolean> &
        Record<HasPrevKey<Casing>, z.ZodBoolean>
>;

interface Pagination<Casing extends PaginationCasing> {
    /**
     * Query schema — `{ page, perPage }`, coerced and defaulted. `page` is the
     * 1-based page number; `perPage` caps the items per page. Drop it onto any
     * route's `query`. It's a plain Zod object, so add filters or sorting with
     * `query.extend({ ... })`.
     */
    query: PaginationQuerySchema<Casing>;
    /**
     * Wrap an item schema in a page envelope — the `items` for this page plus
     * `totalItems`, `page`, `perPage`, `totalPages`, `hasNextPage`,
     * `hasPreviousPage`. The result is a plain Zod object too, so extend it via
     * `.extend()`.
     */
    of: <Item extends z.ZodType>(itemSchema: Item) => PaginatedSchema<Item, Casing>;
}

/**
 * Configure pagination once, then compose it into any route.
 *
 * `createPagination()` returns a `query` schema and an `of(item)` response
 * wrapper using the common `page` / `per_page` shape. Drop the schemas into
 * routes individually — alongside any other query params or response statuses —
 * so a paginated endpoint is still a normal kizuna route, and the handler,
 * client, OpenAPI, and Swift output all infer from it.
 *
 * ```ts
 * import { createPagination } from '@ts-kizuna/core/schemas';
 *
 * const pagination = createPagination(); // or createPagination('snake_case')
 *
 * listUsers: {
 *     method: 'GET',
 *     path: '/users',
 *     query: pagination.query, // ?page=2&perPage=10
 *     responses: {
 *         200: pagination.of(UserSchema),
 *         404: ProblemDetailsSchema,
 *     },
 * }
 * ```
 *
 * The handler slices by `page` / `perPage` and fills in the metadata:
 *
 * ```ts
 * listUsers: ({ query }) => {
 *     const start = (query.page - 1) * query.perPage;
 *     const items = allUsers.slice(start, start + query.perPage);
 *     const totalPages = Math.max(1, Math.ceil(allUsers.length / query.perPage));
 *     return {
 *         status: 200,
 *         body: {
 *             items,
 *             totalItems: allUsers.length,
 *             page: query.page,
 *             perPage: query.perPage,
 *             totalPages,
 *             hasNextPage: query.page < totalPages,
 *             hasPreviousPage: query.page > 1,
 *         },
 *     };
 * }
 * ```
 *
 * One config, reused across resources — `pagination.of(OrderSchema)` on another
 * route speaks the same wire shape. Extend either side however you choose; the
 * extra fields flow into the inferred types.
 */
export const createPagination = <const Casing extends PaginationCasing = 'camelCase'>(casing?: Casing): Pagination<Casing> => {
    const snake = casing === 'snake_case';
    const perPageKey = snake ? 'per_page' : 'perPage';
    const totalItemsKey = snake ? 'total_items' : 'totalItems';
    const totalPagesKey = snake ? 'total_pages' : 'totalPages';
    const hasNextKey = snake ? 'has_next_page' : 'hasNextPage';
    const hasPrevKey = snake ? 'has_previous_page' : 'hasPreviousPage';

    const query = z.object({
        page: z.number().int().min(1).default(1).meta({
            description: 'Page number, starting at 1.',
            example: 1,
        }),
        [perPageKey]: z.number().int().min(1).default(10).meta({
            description: 'Number of items per page.',
            example: 10,
        }),
    }) as PaginationQuerySchema<Casing>;

    const of = (<Item extends z.ZodType>(itemSchema: Item) =>
        z.object({
            items: z.array(itemSchema),
            [totalItemsKey]: z.number().int().min(0).meta({
                description: 'Total number of items across all pages.',
            }),
            page: z.number().int().min(1).meta({
                description: 'Current page number.',
            }),
            [perPageKey]: z.number().int().min(1).meta({
                description: 'Number of items per page.',
            }),
            [totalPagesKey]: z.number().int().min(0).meta({
                description: 'Total number of pages available.',
            }),
            [hasNextKey]: z.boolean().meta({
                description: 'Whether a next page exists.',
            }),
            [hasPrevKey]: z.boolean().meta({
                description: 'Whether a previous page exists.',
            }),
        })) as Pagination<Casing>['of'];

    return {
        query,
        of,
    };
};
