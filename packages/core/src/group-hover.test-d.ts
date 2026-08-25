import { expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { Kizuna } from './kizuna.js';

const groups = Kizuna.groups({
    users: { title: 'Users', pathPrefix: '/users' },
    workspace: {
        title: 'Workspace',
        pathPrefix: '/workspace',
        groups: {
            members: {
                title: 'Members',
                pathPrefix: '/members',
                groups: { roles: { title: 'Member roles', pathPrefix: '/:id/roles' } },
            },
            invites: { title: 'Invites', pathPrefix: { absolute: '/invites' } },
        },
    },
});
const k = new Kizuna({ groups });

test('hover shows the resolved URL, composed down the lineage', () => {
    const users = k.routes.users({
        listUsers: { method: 'GET', path: '/', responses: { 200: z.string() } },
        getUser: { method: 'GET', path: '/:id', responses: { 200: z.string() } },
        uploadAvatar: { method: 'POST', path: { absolute: '/avatar' }, responses: { 200: z.string() } },
    });
    expectTypeOf(users.listUsers.path).toEqualTypeOf<'/users'>();
    expectTypeOf(users.getUser.path).toEqualTypeOf<'/users/:id'>();
    expectTypeOf(users.uploadAvatar.path).toEqualTypeOf<'/avatar'>();

    const roles = k.routes.workspace.members.roles({
        setRole: { method: 'PUT', path: '/', responses: { 200: z.string() } },
        getRole: { method: 'GET', path: '/:roleId', responses: { 200: z.string() } },
    });
    expectTypeOf(roles.setRole.path).toEqualTypeOf<'/workspace/members/:id/roles'>();
    expectTypeOf(roles.getRole.path).toEqualTypeOf<'/workspace/members/:id/roles/:roleId'>();

    const invites = k.routes.workspace.invites({
        getInvite: { method: 'GET', path: '/:token', responses: { 200: z.string() } },
    });
    expectTypeOf(invites.getInvite.path).toEqualTypeOf<'/invites/:token'>();
});
