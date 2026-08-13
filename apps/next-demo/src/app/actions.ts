'use server';

import { revalidatePath } from 'next/cache';
import { apiClient, memberClient } from '../lib/api-client';

export const createUserAction = async (formData: FormData) => {
    const name = String(formData.get('name') ?? '');
    const email = String(formData.get('email') ?? '');
    await apiClient.users.createUser({
        body: {
            name,
            email,
        },
    });
    revalidatePath('/');
};

export const deleteUserAction = async (formData: FormData) => {
    const id = String(formData.get('id') ?? '');
    if (!id) return;
    await apiClient.users.deleteUser({
        params: {
            id,
        },
    });
    revalidatePath('/');
};

export const removeMemberAction = async (formData: FormData) => {
    const id = String(formData.get('id') ?? '');
    if (!id) return;
    await memberClient.members.removeMember({
        params: {
            id,
        },
    });
    revalidatePath('/');
};
