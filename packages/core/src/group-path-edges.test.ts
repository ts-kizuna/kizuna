import { describe, expect, it } from 'vitest';
import { resolvePath } from './group-path.js';
import { z } from 'zod';
import { createGroups } from './groups.js';
import { buildGroupRoutes } from './group-routes.js';

describe('path resolution edge cases', () => {
    it('rejects a prefix with a trailing slash', () => {
        expect(() => createGroups({ users: { title: 'Users', pathPrefix: '/users/' } })).toThrow(
            'The group "users" has the prefix "/users/", which must not end with "/".'
        );
    });
    it('rejects a prefix of just root', () => {
        expect(() => createGroups({ users: { title: 'Users', pathPrefix: '/' } })).toThrow(
            'The group "users" is prefixed "/", which adds nothing. Leave pathPrefix off.'
        );
    });
    it('rejects a prefix missing a leading slash', () => {
        // @ts-expect-error a prefix is a RoutePath
        expect(() => createGroups({ users: { title: 'Users', pathPrefix: 'users' } })).toThrow('must start with "/"');
    });
    it('absolute escape to root', () => {
        expect(resolvePath('/users', { absolute: '/' })).toBe('/');
    });
    it('empty prefix keeps the path', () => {
        expect(resolvePath('', '/events')).toBe('/events');
    });
});

describe('a route path that repeats its group prefix', () => {
    const groups = createGroups({
        notifications: {
            title: 'Notifications',
            pathPrefix: '/notifications',
        },
    });

    it('is rejected', () => {
        const routes = buildGroupRoutes(groups, () => {});
        expect(() =>
            routes.notifications({
                listEvents: { method: 'GET', path: '/notifications/events', responses: { 200: z.string() } },
            })
        ).toThrow(
            'Route "listEvents" has the path "/notifications/events", which already starts with its group\'s prefix "/notifications".'
        );
    });

    it('is allowed through the absolute escape', () => {
        const routes = buildGroupRoutes(groups, () => {});
        const declared = routes.notifications({
            legacy: { method: 'GET', path: { absolute: '/notifications/legacy' }, responses: { 200: z.string() } },
        });
        expect(declared.legacy.path).toBe('/notifications/legacy');
    });

    it('leaves a merely similar path alone', () => {
        const routes = buildGroupRoutes(groups, () => {});
        const declared = routes.notifications({
            settings: { method: 'GET', path: '/notificationsettings', responses: { 200: z.string() } },
        });
        expect(declared.settings.path).toBe('/notifications/notificationsettings');
    });
});
