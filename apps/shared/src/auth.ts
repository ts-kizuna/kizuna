import { k } from './k';
import { routes } from './routes/index';

export const auth = k.auth(routes, {
    users: false,
    health: false,
    notifications: false,
    members: {
        '*': 'user',
        inviteMember: {
            member: {
                role: ['owner', 'admin'],
            },
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
    invites: 'inviteToken',
});
