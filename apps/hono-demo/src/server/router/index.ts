import { server } from '../server';
import { users } from './users';
import { notifications } from './notifications';
import { health } from './health';
import { members } from './members';
import { workspace } from './workspace';
import { invites } from './invites';

export const router = server.router({
    users,
    notifications,
    health,
    members,
    workspace,
    invites,
});
