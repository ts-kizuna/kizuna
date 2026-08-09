import { Kizuna } from '@ts-kizuna/core';
import { z } from 'zod';

const k = new Kizuna();

export const routes = k.routes({
    /**
     * @summary Create a user
     * @description Emails are unique.
     * @example { name: 'Ada Lovelace' }
     */
    createUser: {
        method: 'POST',
        path: '/users',
        body: z.object({
            /**
             * @description Display name
             * @example Ada Lovelace
             * @example Grace Hopper
             * @deprecated use `fullName`
             */
            name: z.string(),
            /**
             * A note to whoever reads this, above tags that do ship.
             *
             * @description Family name
             * @deprecated
             */
            last_name: z.string(),
        }),
        responses: {},
    },
});
