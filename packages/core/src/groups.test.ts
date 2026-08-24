import { describe, expect, it } from 'vitest';
import { createGroups } from './groups.js';
import { resolvePath } from './group-path.js';

describe('Kizuna.groups', () => {
    it('normalizes a title string into GroupOptions', () => {
        const groups = createGroups({
            health: 'Health',
        });
        expect(groups.groups.health).toEqual({
            title: 'Health',
        });
    });

    it('keys every group by its dotted path, outermost first', () => {
        const groups = createGroups({
            workspace: {
                title: 'Workspace',
                groups: {
                    members: {
                        title: 'Members',
                        groups: {
                            roles: 'Member roles',
                        },
                    },
                },
            },
            health: 'Health',
        });
        expect(Object.keys(groups.groups)).toEqual(['workspace', 'workspace.members', 'workspace.members.roles', 'health']);
    });

    it('resolves lineage and children as dotted paths', () => {
        const groups = createGroups({
            workspace: {
                title: 'Workspace',
                groups: {
                    members: {
                        title: 'Members',
                        groups: {
                            roles: 'Member roles',
                        },
                    },
                    invites: 'Invites',
                },
            },
        });
        expect(groups.roots).toEqual(['workspace']);
        expect(groups.resolved.get('workspace')?.children).toEqual(['workspace.members', 'workspace.invites']);
        expect(groups.resolved.get('workspace.members.roles')?.lineage).toEqual([
            'workspace',
            'workspace.members',
            'workspace.members.roles',
        ]);
        expect(groups.resolved.get('workspace.members.roles')?.children).toEqual([]);
    });

    it('lets a key repeat under a different parent', () => {
        const groups = createGroups({
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
        expect(groups.groups['workspace.settings'].title).toBe('Workspace settings');
        expect(groups.groups['users.settings'].title).toBe('User settings');
    });

    it('composes a pathPrefix down the lineage', () => {
        const groups = createGroups({
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
                },
            },
        });
        expect(groups.resolved.get('workspace')?.pathPrefix).toBe('/workspace');
        expect(groups.resolved.get('workspace.members')?.pathPrefix).toBe('/workspace/members');
        expect(groups.resolved.get('workspace.members.roles')?.pathPrefix).toBe('/workspace/members/:id/roles');
    });

    it('starts from the root for an absolute prefix', () => {
        const groups = createGroups({
            workspace: {
                title: 'Workspace',
                pathPrefix: '/workspace',
                groups: {
                    invites: {
                        title: 'Invites',
                        pathPrefix: {
                            absolute: '/invites',
                        },
                    },
                },
            },
        });
        expect(groups.resolved.get('workspace.invites')?.pathPrefix).toBe('/invites');
    });

    it('inherits the parent prefix when a group declares none', () => {
        const groups = createGroups({
            workspace: {
                title: 'Workspace',
                pathPrefix: '/workspace',
                groups: {
                    settings: 'Workspace settings',
                },
            },
        });
        expect(groups.resolved.get('workspace.settings')?.pathPrefix).toBe('/workspace');
    });

    it('leaves a nested group unprefixed when no ancestor declares one', () => {
        const groups = createGroups({
            notifications: {
                title: 'Notifications',
                groups: {
                    webhooks: 'Webhooks',
                },
            },
        });
        expect(groups.resolved.get('notifications.webhooks')?.pathPrefix).toBe('');
    });

    it('cuts the chain below an absolute prefix', () => {
        const groups = createGroups({
            workspace: {
                title: 'Workspace',
                pathPrefix: '/workspace',
                groups: {
                    invites: {
                        title: 'Invites',
                        pathPrefix: {
                            absolute: '/invites',
                        },
                        groups: {
                            accepted: {
                                title: 'Accepted invites',
                                pathPrefix: '/accepted',
                            },
                        },
                    },
                },
            },
        });
        expect(groups.resolved.get('workspace.invites.accepted')?.pathPrefix).toBe('/invites/accepted');
    });

    it('leaves the prefix empty when a group declares none', () => {
        const groups = createGroups({
            notifications: 'Notifications',
        });
        expect(groups.resolved.get('notifications')?.pathPrefix).toBe('');
    });

    it('rejects two groups sharing a title, whatever their depth', () => {
        expect(() =>
            createGroups({
                workspace: {
                    title: 'Workspace',
                    groups: {
                        archive: 'Archive',
                    },
                },
                users: {
                    title: 'Users',
                    groups: {
                        archive: 'Archive',
                    },
                },
            })
        ).toThrow('The groups "workspace.archive" and "users.archive" share the title "Archive". A title names one group.');
    });
});

describe('resolvePath', () => {
    it('joins the prefix and the route path', () => {
        expect(resolvePath('/workspace/members', '/:id')).toBe('/workspace/members/:id');
    });

    it('resolves "/" to the prefix, not a trailing slash', () => {
        expect(resolvePath('/users', '/')).toBe('/users');
    });

    it('leaves the path alone when the group has no prefix', () => {
        expect(resolvePath('', '/notifications')).toBe('/notifications');
        expect(resolvePath('', '/')).toBe('/');
    });

    it('ignores the prefix for an absolute path', () => {
        expect(
            resolvePath('/users', {
                absolute: '/avatar',
            })
        ).toBe('/avatar');
    });

    it('carries a parameter in the prefix through to the resolved path', () => {
        expect(resolvePath('/workspace/members/:id/roles', '/')).toBe('/workspace/members/:id/roles');
        expect(resolvePath('/workspace/members/:id/roles', '/:roleId')).toBe('/workspace/members/:id/roles/:roleId');
    });
});
