import { db } from '@ts-kizuna-demo/shared';
import { server } from './server';
import { verifyPayments, verifySource } from './verifiers';

export const payments = server.receiver('payments', {
    verify: verifyPayments,
    handler: async ({ body, headers, jobs }) => {
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

export const source = server.receiver('source', {
    verify: verifySource,
    handler: ({ body, throwError }) => {
        if (body.repository.name === 'archived') {
            throwError({
                status: 422,
                body: {
                    detail: 'That repository is archived, so this will never succeed',
                },
            });
        }
    },
});

export const receiverImplementations = {
    payments,
    source,
};
