import { k } from './k.js';
import { routes } from './routes/index.js';

export const access = k.access(routes, {
    users: false,
    health: false,
    notifications: false,
    invites: 'inviteToken',
    members: {
        '*': 'user',
        inviteMember: {
            member: {
                role: ['owner', 'admin'],
            },
        },
        removeMember: {
            auth: 'member',
            permission: 'manageMembers',
        },
    },
    workspace: {
        '*': 'member',
        deleteWorkspace: {
            member: {
                role: 'owner',
            },
        },
        transfer: {
            member: {
                role: 'owner',
            },
        },
    },
});
