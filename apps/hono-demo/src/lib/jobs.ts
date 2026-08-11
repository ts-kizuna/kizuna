import { db } from '@ts-kizuna-demo/shared';
import { server } from './server';

export const jobHandlers = server.jobs({
    users: {
        sendDigests: async () => ({
            status: 200,
            body: {
                sent: await db.users.count(),
            },
        }),

        indexUser: async ({ input, throwError }) => {
            const user = await db.users.findById(input.userId);
            if (!user) {
                throwError({
                    status: 422,
                    body: {
                        detail: `No user with id ${input.userId}`,
                    },
                });
            }
            return {
                status: 200,
                body: {
                    indexed: true,
                },
            };
        },
    },

    workspaces: {
        reconcile: async () => ({
            status: 200,
            body: {
                reconciled: await db.users.count(),
            },
        }),

        expireInvites: () => ({
            status: 204,
            body: undefined,
        }),
    },
});
