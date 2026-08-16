import { ProblemDetailsSchema } from '@ts-kizuna/contract/schemas';
import { z } from 'zod';
import { k } from '../k.js';
import { UserSchema } from './users.js';

const workspaceMembers = k.routes('members', {
    listMembers: {
        method: 'GET',
        path: '/workspace/members',
        responses: {
            200: z.object({
                members: z.array(UserSchema),
            }),
        },
        summary: 'List workspace members',
    },
    inviteMember: {
        method: 'POST',
        path: '/workspace/members',
        body: z.object({
            email: z.email(),
        }),
        responses: {
            201: UserSchema,
            409: ProblemDetailsSchema,
        },
        summary: 'Invite a member to the workspace',
    },
});

const workspaceInfo = k.routes('workspace', {
    getWorkspace: {
        method: 'GET',
        path: '/workspace',
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
        path: '/workspace',
        responses: {
            200: z.object({
                ok: z.boolean(),
            }),
        },
        summary: 'Delete the workspace, owner-only via the auth map',
    },
    transfer: {
        method: 'POST',
        path: '/workspace/transfer',
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
});

export const workspaceRoutes = {
    members: workspaceMembers,
    info: workspaceInfo,
};
