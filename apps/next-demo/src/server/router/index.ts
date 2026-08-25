import { server } from '../server';
import { users } from './users';
import { health } from './health';
import { notifications } from './notifications';
import { workspace } from './workspace';

export const router = server.router({
    users,
    health,
    notifications,
    workspace,
});
