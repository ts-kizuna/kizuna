import type { z } from 'zod';
import type { OrderSchema } from './contract.js';

type Order = z.infer<typeof OrderSchema>;

const orders: Order[] = [
    {
        id: 'ord_1001',
        status: 'shipped',
        total: 49.9,
    },
    {
        id: 'ord_1002',
        status: 'pending',
        total: 129,
    },
    {
        id: 'ord_1003',
        status: 'delivered',
        total: 12.5,
    },
];

export const orderStore = {
    findById(id: string): Order | undefined {
        return orders.find((candidate) => candidate.id === id);
    },
    search(query: string): Order[] {
        const needle = query.toLowerCase();
        return orders.filter((candidate) => candidate.id.includes(needle) || candidate.status.includes(needle));
    },
};
