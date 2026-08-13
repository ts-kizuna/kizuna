import { ProblemDetailsSchema } from '@ts-kizuna/core/schemas';
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
    removeMember: {
        method: 'DELETE',
        path: '/workspace/members/:id',
        responses: {
            200: z.object({
                ok: z.boolean(),
            }),
            403: ProblemDetailsSchema,
            404: ProblemDetailsSchema,
        },
        summary: 'Remove a member from the workspace',
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
            403: ProblemDetailsSchema,
        },
        summary: 'Transfer ownership, owner-only via the auth map and gated on `membership.promote`',
    },
});

export const workspaceRoutes = {
    members: workspaceMembers,
    info: workspaceInfo,
};
