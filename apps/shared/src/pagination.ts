import { z } from 'zod';

export const PaginationQuery = z.object({
    page: z.number().int().min(1).default(1).meta({
        description: 'Page number, starting at 1',
        example: 1,
    }),
    limit: z.number().int().min(1).max(100).default(10).meta({
        description: 'Page size (1–100)',
        example: 10,
    }),
});
