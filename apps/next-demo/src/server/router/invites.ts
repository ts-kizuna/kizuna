import type { Router } from '@ts-kizuna/next';
import type { contract } from '@ts-kizuna-demo/shared';

export const invites: Router<typeof contract.routes.invites> = {
    getInvite: ({ auth }) => ({
        status: 200,
        body: {
            inviteId: auth.inviteToken.inviteId,
            email: auth.inviteToken.email,
        },
    }),
    acceptInvite: ({ auth }) => ({
        status: 201,
        body: {
            userId: `usr_${auth.inviteToken.inviteId}`,
        },
    }),
};
