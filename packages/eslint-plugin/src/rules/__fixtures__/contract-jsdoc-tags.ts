import { Kizuna } from '@ts-kizuna/core';
import { z } from 'zod';

const k = new Kizuna();

export const routes = k.routes({
    /**
     * @descriptionn Creates a user.
     */
    createUser: {
        method: 'POST',
        path: '/users',
        body: z.object({
            /**
             * @description
             */
            name: z.string(),
            /**
             * @exmaple Ada Lovelace
             */
            fullName: z.string(),
            /**
             * @description Family name.
             * @description Kept verbatim on the wire.
             * @deprecated
             */
            last_name: z.string(),
        }),
        responses: {},
    },
    /**
     * A note to whoever reads this, with no tags at all.
     *
     * @summary Lists every user in the workspace, with their roles, their invitations, and the teams they belong to, all in one response that the client pages through
     * @param unused nothing reads this, but it is a real JSDoc tag
     * @see https://example.com/docs
     */
    listUsers: {
        method: 'GET',
        path: '/users',
        responses: {},
    },
});
