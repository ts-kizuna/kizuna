'use server';

import { createServerAction } from '@ts-kizuna/next';
import { apiClient } from '../lib/api-client';

export const createUser = createServerAction(apiClient.users.createUser, {
    revalidate: {
        paths: ['/'],
    },
});

export const deleteUser = createServerAction(apiClient.users.deleteUser, {
    revalidate: {
        paths: ['/'],
    },
});
