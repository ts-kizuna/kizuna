import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createGroups } from './groups.js';
import { buildGroupRoutes } from './group-routes.js';

const groups = createGroups({
    users: {
        title: 'Users',
        pathPrefix: '/users',
    },
    notifications: 'Notifications',
    workspace: {
        title: 'Workspace',
        pathPrefix: '/workspace',
        groups: {
            members: {
                title: 'Members',
                pathPrefix: '/members',
                groups: {
                    roles: {
                        title: 'Member roles',
                        pathPrefix: '/:id/roles',
                    },
                },
            },
            invites: {
                title: 'Invites',
                pathPrefix: {
                    absolute: '/invites',
                },
            },
        },
    },
});

const routes = buildGroupRoutes(groups, () => {});

describe('k.routes accessor tree', () => {
    it('resolves a route path against its group prefix', () => {
        const declared = routes.users({
            listUsers: { method: 'GET', path: '/', responses: { 200: z.string() } },
            getUser: { method: 'GET', path: '/:id', responses: { 200: z.string() } },
        });
        expect(declared.listUsers.path).toBe('/users');
        expect(declared.getUser.path).toBe('/users/:id');
    });

    it('lets a route opt out with an absolute path', () => {
        const declared = routes.users({
            uploadAvatar: { method: 'POST', path: { absolute: '/avatar' }, responses: { 200: z.string() } },
        });
        expect(declared.uploadAvatar.path).toBe('/avatar');
    });

    it('leaves paths alone for a group with no prefix', () => {
        const declared = routes.notifications({
            listEvents: { method: 'GET', path: '/events', responses: { 200: z.string() } },
        });
        expect(declared.listEvents.path).toBe('/events');
    });

    it('reaches a nested group by property path', () => {
        const declared = routes.workspace.members.roles({
            setRole: { method: 'PUT', path: '/', responses: { 200: z.string() } },
            getRole: { method: 'GET', path: '/:roleId', responses: { 200: z.string() } },
        });
        expect(declared.setRole.path).toBe('/workspace/members/:id/roles');
        expect(declared.getRole.path).toBe('/workspace/members/:id/roles/:roleId');
    });

    it('starts from the root for an absolute group prefix', () => {
        const declared = routes.workspace.invites({
            getInvite: { method: 'GET', path: '/:token', responses: { 200: z.string() } },
        });
        expect(declared.getInvite.path).toBe('/invites/:token');
    });

    it('is callable at the root for ungrouped routes', () => {
        const declared = routes({
            ping: { method: 'GET', path: '/ping', responses: { 200: z.string() } },
        });
        expect(declared.ping.path).toBe('/ping');
    });
});
