import { z } from 'zod';
import { k } from './k';

export const payments = k.receiver({
    path: '/webhooks/payments',
    summary: 'Payment events from the billing provider',
    body: z.object({
        id: z.string(),
        type: z.enum(['invoice.paid', 'invoice.failed']),
        data: z.looseObject({
            id: z.string(),
        }),
    }),
});

export const source = k.receiver({
    path: '/webhooks/source',
    summary: 'Repository events from the source host',
    body: z.object({
        action: z.string(),
        repository: z.object({
            name: z.string(),
        }),
    }),
});

export const receivers = {
    payments,
    source,
};
