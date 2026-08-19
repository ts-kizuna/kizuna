import { z } from 'zod';
import { k } from './k';
import { UserSchema } from './routes/users';

/**
 * The events the API posts out, grouped the way a real contract would be.
 */
export const webhooks = k.webhooks({
    users: {
        userCreated: {
            summary: 'Sent when a user is created',
            body: UserSchema,
        },
        userDeleted: {
            summary: 'Sent when a user is deleted',
            retry: 3,
            body: z.object({
                userId: z.string(),
                deletedAt: z.iso.datetime(),
            }),
        },
    },
});
