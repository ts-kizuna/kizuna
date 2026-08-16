import { db } from '@ts-kizuna-demo/shared';
import type { Router } from '@ts-kizuna/server/next';
import type { contract } from '@ts-kizuna-demo/shared';

export const workspace: Router<typeof contract.routes.workspace> = {
    getWorkspace: ({ auth }) => ({
        status: 200,
        body: {
            id: auth.member.workspaceUserId,
            name: 'ts-kizuna workspace',
        },
    }),
    deleteWorkspace: ({ auth }) => ({
        status: 200,
        body: {
            ok: auth.member.role === 'owner',
        },
    }),
    transfer: async ({ body, auth }) => {
        if (body.toUserId === auth.member.workspaceUserId) {
            return {
                status: 200,
                body: {
                    ok: false,
                },
            };
        }
        await db.users.delete(body.toUserId);
        return {
            status: 200,
            body: {
                ok: true,
            },
        };
    },
};
