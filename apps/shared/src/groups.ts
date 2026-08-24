import { Kizuna } from '@ts-kizuna/core';

export const groups = Kizuna.groups({
    health: {
        title: 'Health',
        description: 'Service health and uptime monitoring',
        pathPrefix: '/health',
    },
    users: {
        title: 'Users',
        description: 'User management routes',
        pathPrefix: '/users',
    },
    notifications: {
        title: 'Notifications',
    },
    workspace: {
        title: 'Workspace',
        pathPrefix: '/workspace',
        groups: {
            members: {
                title: 'Members',
                pathPrefix: '/members',
            },
            invites: {
                title: 'Invites',
                description: 'Invite capability URLs, guarded by a path-token custom identity',
                pathPrefix: {
                    absolute: '/invites',
                },
            },
        },
    },
});
