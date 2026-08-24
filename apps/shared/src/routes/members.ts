import { ProblemDetailsSchema } from '@ts-kizuna/core/schemas';
import { z } from 'zod';
import { k } from '../k';
import { UserSchema } from './users';

export const memberRoutes = k.routes.workspace.members({
    listMembers: {
        method: 'GET',
        path: '/',
        responses: {
            200: z.object({
                members: z.array(UserSchema),
            }),
        },
        summary: 'List workspace members',
    },
    inviteMember: {
        method: 'POST',
        path: '/',
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
