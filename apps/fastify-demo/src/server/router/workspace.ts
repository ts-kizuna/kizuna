import { db } from '@ts-kizuna-demo/shared';
import type { Router } from '@ts-kizuna/fastify';
import type { contract } from '@ts-kizuna-demo/shared';

export const workspace: Router<typeof contract.routes.workspace> = {
    getWorkspace: ({ auth }) => ({
        status: 200,
        body: {
            id: auth.member.workspaceUserId,
            name: 'Demo Workspace',
        },
    }),
    deleteWorkspace: ({ auth }) => ({
        status: 200,
        body: {
            ok: auth.member.role === 'owner',
        },
    }),
    transfer: async ({ body, auth, can, throwError }) => {
        if (body.toUserId === auth.member.workspaceUserId) {
            return {
                status: 200,
                body: {
                    ok: false,
                },
            };
        }
        const targetUser = await db.users.findById(body.toUserId);
        if (!targetUser || !(await can.promoteMember(targetUser))) {
            throwError({
                status: 403,
                body: {
                    detail: 'Ownership can only be transferred to a workspace member',
                },
            });
        }
        return {
            status: 200,
            body: {
                ok: true,
            },
        };
    },
};
