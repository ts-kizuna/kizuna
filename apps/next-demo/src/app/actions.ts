'use server';

import { revalidatePath } from 'next/cache';
import { createServerAction } from '@ts-kizuna/next';
import { apiClient } from '../lib/api-client';

export const createUser = createServerAction(apiClient.users.createUser, {
    onSuccess: () => {
        revalidatePath('/');
    },
});

export const deleteUser = createServerAction(apiClient.users.deleteUser, {
    onSuccess: () => {
        revalidatePath('/');
    },
});
