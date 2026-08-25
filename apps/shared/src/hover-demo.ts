import { contract } from './contract';
import { memberRoutes } from './routes/members';
import { inviteRoutes } from './routes/invites';
import { usersRoutes } from './routes/users';

// Hover any of these. The resolved URL is the type, no plugin involved.

export const listMembersPath = memberRoutes.listMembers.path;
//           ^? '/workspace/members'

export const getInvitePath = inviteRoutes.getInvite.path;
//           ^? '/invites/:token'

export const avatarPath = usersRoutes.uploadAvatar.path;
//           ^? '/avatar'

export const throughContract = contract.routes.workspace.members.listMembers.path;
//           ^? '/workspace/members'
