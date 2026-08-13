import { Kizuna } from '@ts-kizuna/core';
import { UserSchema } from './models.js';

export const promoteMember = Kizuna.permission({
    appliesTo: UserSchema,
    description: 'Hand workspace ownership to a specific member',
});

export const manageMembers = Kizuna.permission({
    description: 'Administer the workspace member list',
});

export const removeMember = Kizuna.permission({
    appliesTo: UserSchema,
    description: 'Remove a specific member from the workspace',
});
