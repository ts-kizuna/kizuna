import { expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { createGroups, type GroupOptions } from './groups.js';
import { buildGroupRoutes } from './group-routes.js';

const groups = createGroups({
    users: {
        title: 'Users',
        pathPrefix: '/users',
    },
    workspace: {
        title: 'Workspace',
        pathPrefix: '/workspace',
        groups: {
            members: {
                title: 'Members',
                pathPrefix: '/workspace/members',
            },
        },
    },
});

const routes = buildGroupRoutes(groups, () => {});

test('a resolved path is an exact literal, not a widened string', () => {
    const declared = routes.users({
        getUser: { method: 'GET', path: '/:id', responses: { 200: z.string() } },
        uploadAvatar: { method: 'POST', path: { absolute: '/avatar' }, responses: { 200: z.string() } },
        listUsers: { method: 'GET', path: '/', responses: { 200: z.string() } },
    });

    expectTypeOf(declared.getUser.path).toEqualTypeOf<'/users/:id'>();
    expectTypeOf(declared.uploadAvatar.path).toEqualTypeOf<'/avatar'>();
    expectTypeOf(declared.listUsers.path).toEqualTypeOf<'/users'>();
});

test('a nested group resolves against its own prefix', () => {
    const declared = routes.workspace.members({
        listMembers: { method: 'GET', path: '/', responses: { 200: z.string() } },
    });

    expectTypeOf(declared.listMembers.path).toEqualTypeOf<'/workspace/members'>();
});

test('an undeclared group is not reachable', () => {
    // @ts-expect-error the set declares no `nope` group under workspace
    routes.workspace.nope;

    // @ts-expect-error the set declares no `billing` group
    routes.billing;
});

test('the flat group map is keyed by the paths actually declared', () => {
    const set = createGroups({
        workspace: {
            title: 'Workspace',
            groups: {
                settings: 'Workspace settings',
            },
        },
        users: {
            title: 'Users',
            groups: {
                settings: 'User settings',
            },
        },
    });

    // exact, so no `?.` and no possible undefined
    expectTypeOf(set.groups['workspace.settings']).toEqualTypeOf<GroupOptions>();
    expectTypeOf(set.groups).toHaveProperty('users.settings');

    // @ts-expect-error the set declares no such path
    set.groups['workspace.nope'];
});
