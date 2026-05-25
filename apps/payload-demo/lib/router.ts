import { createRouter } from '@ts-kizuna/payload';
import { contract } from '../contract';

interface Order {
    id: string;
    status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
    customerName: string;
    total: number;
}

const orders = new Map<string, Order>();
let nextId = 1;

export const router = createRouter(contract, {
    orders: {
        create: ({ body }) => {
            const id = String(nextId++);
            const order: Order = {
                id,
                status: 'pending',
                customerName: body.customerName,
                total: body.items.reduce((sum, item) => sum + item.quantity * 10, 0),
            };
            orders.set(id, order);
            return {
                status: 201,
                body: order,
            };
        },
        get: ({ params }) => {
            const order = orders.get(params.id);
            if (!order) {
                return {
                    status: 404,
                    body: {
                        message: 'Order not found',
                    },
                };
            }
            return {
                status: 200,
                body: order,
            };
        },
        list: ({ query }) => {
            const all = Array.from(orders.values());
            const filtered = query.status ? all.filter((order) => order.status === query.status) : all;
            const start = (query.page - 1) * query.limit;
            return {
                status: 200,
                body: {
                    orders: filtered.slice(start, start + query.limit),
                    total: filtered.length,
                },
            };
        },
    },
});
