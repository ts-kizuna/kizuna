import { z } from 'zod';
import { k } from './k';

export const payments = k.receiver({
    path: '/webhooks/payments',
    summary: 'Payment events from the billing provider',
    body: z.object({
        id: z.string(),
        type: z.enum(['invoice.paid', 'invoice.failed', 'invoice.voided']),
        data: z.looseObject({
            id: z.string(),
        }),
    }),
});

export const receivers = {
    payments,
};
