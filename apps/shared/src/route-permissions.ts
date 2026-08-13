import { k } from './k.js';
import { routes } from './routes/index.js';

export const routePermissions = k.permissions(routes, {
    users: false,
    health: false,
    notifications: {
        '*': false,
        listEvents: 'viewEventLog',
    },
    members: {
        '*': false,
        removeMember: 'manageMembers',
    },
    invites: false,
    workspace: false,
});
