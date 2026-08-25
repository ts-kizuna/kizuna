import { server } from '../server';
import { users } from './users';
import { notifications } from './notifications';
import { health } from './health';
import { workspace } from './workspace';

export const router = server.router({
    users,
    notifications,
    health,
    workspace,
});
