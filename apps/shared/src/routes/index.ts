export * from './users.js';
export * from './health.js';
export * from './workspace.js';
export * from './notifications.js';
export * from './invites.js';

import { usersRoutes } from './users.js';
import { healthRoutes } from './health.js';
import { workspaceRoutes } from './workspace.js';
import { notificationsRoutes } from './notifications.js';
import { inviteRoutes } from './invites.js';

export const routes = {
    users: usersRoutes,
    health: healthRoutes,
    notifications: notificationsRoutes,
    members: workspaceRoutes.members,
    workspace: workspaceRoutes.info,
    invites: inviteRoutes,
};
