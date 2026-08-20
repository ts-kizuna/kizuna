import { db } from '@ts-kizuna-demo/shared';
import { server } from './server';
import { verifyPayments } from './verifiers';

export const payments = server.receiver('payments', {
    verify: verifyPayments,
    handler: async ({ body, headers, jobs, throwError }) => {
        if (body.type === 'invoice.voided') {
            throwError({
                status: 422,
                body: {
                    detail: 'A voided invoice will never settle, so this will never succeed',
                },
            });
        }
        if (body.type === 'invoice.failed') {
            await jobs.users.indexUser.queue({
                input: {
                    userId: body.data.id,
                },
                dedupeKey: headers['x-delivery-id'] ?? body.id,
            });
            return;
        }
        const user = await db.users.findById(body.data.id);
        if (!user) {
            return {
                status: 503,
                body: {
                    detail: `No user for ${body.data.id} yet`,
                },
            };
        }
    },
});

export const receiverImplementations = {
    payments,
};
