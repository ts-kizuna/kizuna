import { ProblemDetailsSchema } from '@ts-kizuna/core/schemas';
import { z } from 'zod';
import { k } from '../k';

export const inviteRoutes = k.routes.workspace.invites({
    getInvite: {
        method: 'GET',
        path: '/:token',
        responses: {
            200: z.object({
                inviteId: z.string(),
                email: z.email(),
            }),
            404: ProblemDetailsSchema,
        },
        summary: 'Resolve an invite by its capability-URL token, guarded by a custom path-token identity',
    },
    acceptInvite: {
        method: 'POST',
        path: '/:token/accept',
        body: z.object({
            name: z.string(),
        }),
        responses: {
            201: z.object({
                userId: z.string(),
            }),
            404: ProblemDetailsSchema,
        },
        summary: 'Accept an invite via the capability URL',
    },
});
