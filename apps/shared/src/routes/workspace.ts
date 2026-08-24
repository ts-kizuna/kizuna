import { z } from 'zod';
import { k } from '../k';
import { memberRoutes } from './members';
import { inviteRoutes } from './invites';

export const workspaceRoutes = k.routes.workspace({
    getWorkspace: {
        method: 'GET',
        path: '/',
        responses: {
            200: z.object({
                id: z.string(),
                name: z.string(),
            }),
        },
        summary: 'Get workspace info',
    },
    deleteWorkspace: {
        method: 'DELETE',
        path: '/',
        responses: {
            200: z.object({
                ok: z.boolean(),
            }),
        },
        summary: 'Delete the workspace, owner-only via the auth map',
    },
    transfer: {
        method: 'POST',
        path: '/transfer',
        body: z.object({
            toUserId: z.string(),
        }),
        responses: {
            200: z.object({
                ok: z.boolean(),
            }),
        },
        summary: 'Transfer ownership, owner-only via the auth map',
    },
    members: memberRoutes,
    invites: inviteRoutes,
});
