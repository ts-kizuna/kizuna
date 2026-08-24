export * from './users';
export * from './health';
export * from './members';
export * from './workspace';
export * from './notifications';
export * from './invites';

import { usersRoutes } from './users';
import { healthRoutes } from './health';
import { workspaceRoutes } from './workspace';
import { notificationsRoutes } from './notifications';

export const routes = {
    users: usersRoutes,
    health: healthRoutes,
    notifications: notificationsRoutes,
    workspace: workspaceRoutes,
};
