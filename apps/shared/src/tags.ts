import { createTags } from '@ts-kizuna/core';

export const tags = createTags({
    health: {
        title: 'Health',
        description: 'Service health and uptime monitoring',
    },
    users: {
        title: 'Users',
        description: 'User management endpoints',
    },
    notifications: {
        title: 'Notifications',
    },
    members: {
        title: 'Members',
    },
    workspace: {
        title: 'Workspace',
    },
    invites: {
        title: 'Invites',
        description: 'Invite capability URLs, guarded by a path-token custom identity',
    },
});
