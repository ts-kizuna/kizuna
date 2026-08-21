import { describe, expect, it } from 'vitest';
import type { FlattenedRoute } from '@ts-kizuna/core/adapter';
import { deriveToolNames, toToolName } from './tool-name.js';

const routesOf = (...routeKeys: string[]): FlattenedRoute[] =>
    routeKeys.map((routeKey) => ({
        routeKey,
        route: {
            method: 'get',
            path: '/',
        },
        routeTags: [],
    })) as unknown as FlattenedRoute[];

describe('toToolName', () => {
    it('splits camelCase humps and dotted groups on underscores', () => {
        expect(toToolName('users.listUsers')).toBe('users_list_users');
        expect(toToolName('getUser')).toBe('get_user');
        expect(toToolName('health')).toBe('health');
    });

    it('keeps an acronym together', () => {
        expect(toToolName('exportHTMLReport')).toBe('export_html_report');
        expect(toToolName('api.whoAmI')).toBe('api_who_am_i');
    });

    it('keeps a digit with the word it follows', () => {
        expect(toToolName('admin.exportV2')).toBe('admin_export_v2');
    });

    it('flattens a group nested more than one level deep', () => {
        expect(toToolName('admin.users.listUsers')).toBe('admin_users_list_users');
    });
});

describe('deriveToolNames', () => {
    it('maps every route key to its tool name', () => {
        expect(deriveToolNames(routesOf('users.getUser', 'health'))).toEqual(
            new Map([
                ['users.getUser', 'users_get_user'],
                ['health', 'health'],
            ])
        );
    });

    it('throws when two route keys converge on one tool name', () => {
        expect(() => deriveToolNames(routesOf('users.listUsers', 'usersList.users'))).toThrow(
            /both become the tool name "users_list_users"/
        );
    });

    it('takes a name at the 128 character maximum', () => {
        expect(() => deriveToolNames(routesOf('a'.repeat(128)))).not.toThrow();
    });

    it('throws when a name exceeds the 128 character maximum', () => {
        expect(() => deriveToolNames(routesOf('a'.repeat(129)))).toThrow(/exceeding the MCP maximum of 128/);
    });

    it('throws when a route key carries a character no client accepts', () => {
        expect(() => deriveToolNames(routesOf('users.get user'))).toThrow(/outside the letters, digits, underscore, and dash/);
    });
});
