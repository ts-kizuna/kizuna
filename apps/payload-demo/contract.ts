import { createContract, ErrorResponse } from '@ts-kizuna/core';
import { z } from 'zod';

const OrderSchema = z.object({
    id: z.string(),
    status: z.enum(['pending', 'confirmed', 'completed', 'cancelled']),
    customerName: z.string(),
    total: z.number(),
});

export const contract = createContract({
    orders: createContract({
        create: {
            method: 'POST',
            path: '/orders',
            body: z.object({
                customerName: z.string().min(1),
                items: z.array(
                    z.object({
                        productId: z.string(),
                        quantity: z.number().int().min(1),
                    })
                ),
            }),
            responses: {
                201: OrderSchema,
            },
        },
        get: {
            method: 'GET',
            path: '/orders/:id',
            responses: {
                200: OrderSchema,
                404: ErrorResponse,
            },
        },
        list: {
            method: 'GET',
            path: '/orders',
            query: z.object({
                status: z.enum(['pending', 'confirmed', 'completed', 'cancelled']).optional(),
                page: z.coerce.number().int().min(1).default(1),
                limit: z.coerce.number().int().min(1).max(100).default(20),
            }),
            responses: {
                200: z.object({
                    orders: z.array(OrderSchema),
                    total: z.number(),
                }),
            },
        },
    }),
});
