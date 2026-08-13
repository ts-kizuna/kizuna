import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { gateableNames, permissionsReport } from './permissions.js';
import { Kizuna } from './kizuna.js';
import type { RouteDefinition, Routes } from './types.js';

const UserSchema = z.object({
    id: z.string(),
});

const viewInvoices = Kizuna.permission({
    description: 'See the workspace invoices',
});

const deleteWorkspace = Kizuna.permission();

const exportLedger = Kizuna.permission();

const promoteMember = Kizuna.permission({
    appliesTo: UserSchema,
});

const routeDefinition = (path: `/${string}`) => ({
    method: 'GET' as const,
    path,
    responses: {
        200: z.object({
            ok: z.boolean(),
        }),
    },
});

const user = Kizuna.identity.bearer({
    context: z.object({
        userId: z.string(),
    }),
});

const makeSurface = () => {
    const k = new Kizuna({
        identities: {
            user,
        },
        permissions: {
            viewInvoices,
            deleteWorkspace,
            exportLedger,
            promoteMember,
        },
    });
    return {
        k,
        members: k.routes({
            listMembers: routeDefinition('/workspace/members'),
            inviteMember: routeDefinition('/workspace/members/invite'),
        }),
        workspaceInfo: k.routes({
            getWorkspace: routeDefinition('/workspace'),
            deleteWorkspace: routeDefinition('/workspace/delete'),
            transfer: routeDefinition('/workspace/transfer'),
        }),
    };
};

const routeOf = (routes: Routes, key: string): RouteDefinition => routes[key] as RouteDefinition;

describe('gateableNames', () => {
    it('lists the permissions a route may demand', () => {
        expect([
            ...gateableNames({
                viewInvoices,
                deleteWorkspace,
                exportLedger,
                promoteMember,
            }),
        ]).toEqual(['viewInvoices', 'deleteWorkspace', 'exportLedger']);
    });

    it('is empty when nothing is declared', () => {
        expect(gateableNames(undefined).size).toBe(0);
    });
});

describe('the permissions map', () => {
    it('resolves a single permission onto every route in a group', () => {
        const { k, members, workspaceInfo } = makeSurface();

        k.contract({
            routes: {
                members,
                workspaceInfo,
            },
            access: {
                members: { auth: 'user', permission: 'viewInvoices' },
                workspaceInfo: false,
            },
        });

        expect(routeOf(members, 'listMembers').permissions).toEqual({ all: ['viewInvoices'] });
        expect(routeOf(members, 'inviteMember').permissions).toEqual({ all: ['viewInvoices'] });
        expect(routeOf(workspaceInfo, 'getWorkspace').permissions).toBeUndefined();
    });

    it('lets a cascade override replace the group default rather than merge into it', () => {
        const { k, members, workspaceInfo } = makeSurface();

        k.contract({
            routes: {
                members,
                workspaceInfo,
            },
            access: {
                members: false,
                workspaceInfo: {
                    '*': { auth: 'user', permission: 'viewInvoices' },
                    deleteWorkspace: { auth: 'user', permission: 'deleteWorkspace' },
                    transfer: { auth: 'user', permission: 'exportLedger' },
                },
            },
        });

        expect(routeOf(workspaceInfo, 'getWorkspace').permissions).toEqual({ all: ['viewInvoices'] });
        expect(routeOf(workspaceInfo, 'deleteWorkspace').permissions).toEqual({ all: ['deleteWorkspace'] });
        expect(routeOf(workspaceInfo, 'transfer').permissions).toEqual({ all: ['exportLedger'] });
    });

    it('opts a route out with false', () => {
        const { k, members, workspaceInfo } = makeSurface();

        k.contract({
            routes: {
                members,
                workspaceInfo,
            },
            access: {
                members: {
                    '*': { auth: 'user', permission: 'viewInvoices' },
                    inviteMember: false,
                },
                workspaceInfo: false,
            },
        });

        expect(routeOf(members, 'listMembers').permissions).toEqual({ all: ['viewInvoices'] });
        expect(routeOf(members, 'inviteMember').permissions).toBeUndefined();
    });

    it('normalizes a list to `all` and an object to `oneOf`', () => {
        const { k, members, workspaceInfo } = makeSurface();

        k.contract({
            routes: {
                members,
                workspaceInfo,
            },
            access: {
                members: {
                    '*': { auth: 'user', permission: ['viewInvoices', 'deleteWorkspace'] },
                    inviteMember: { auth: 'user', permission: { oneOf: ['deleteWorkspace', 'exportLedger'] } },
                },
                workspaceInfo: false,
            },
        });

        expect(routeOf(members, 'listMembers').permissions).toEqual({
            all: ['viewInvoices', 'deleteWorkspace'],
        });
        expect(routeOf(members, 'inviteMember').permissions).toEqual({
            oneOf: ['deleteWorkspace', 'exportLedger'],
        });
    });

    it('treats an empty list as no requirement', () => {
        const { k, members, workspaceInfo } = makeSurface();

        k.contract({
            routes: {
                members,
                workspaceInfo,
            },
            access: {
                members: false,
                workspaceInfo: false,
            },
        });

        expect(routeOf(members, 'listMembers').permissions).toBeUndefined();
    });
});

describe('the permissions map, rejected', () => {
    it('throws on a permission that is not declared', () => {
        const { k, members, workspaceInfo } = makeSurface();

        expect(() =>
            // @ts-expect-error 'archiveMember' is not declared
            k.contract({
                routes: {
                    members,
                    workspaceInfo,
                },
                access: {
                    members: { auth: 'user', permission: 'archiveMember' },
                    workspaceInfo: false,
                },
            })
        ).toThrow(/Permission 'archiveMember' at 'members.listMembers' is not declared/);
    });

    it('throws when a route demands a permission that applies to a record', () => {
        const { k, members, workspaceInfo } = makeSurface();

        expect(() =>
            // @ts-expect-error 'promoteMember' applies to a record, so a route cannot demand it
            k.contract({
                routes: {
                    members,
                    workspaceInfo,
                },
                access: {
                    members: { auth: 'user', permission: 'promoteMember' },
                    workspaceInfo: false,
                },
            })
        ).toThrow(/applies to a record, so a route cannot demand it/);
    });

    it('throws on a map key that names no route group', () => {
        const { k, members, workspaceInfo } = makeSurface();

        expect(() =>
            // @ts-expect-error 'invoices' is not a route group
            k.contract({
                routes: {
                    members,
                    workspaceInfo,
                },
                access: {
                    members: false,
                    workspaceInfo: false,
                    invoices: false,
                },
            })
        ).toThrow("Access map key 'invoices' does not match a route group in the contract.");
    });

    it('throws on a cascade key that matches nothing in the group', () => {
        const { k, members, workspaceInfo } = makeSurface();

        expect(() =>
            // @ts-expect-error 'removeMember' is not a route in this group
            k.contract({
                routes: {
                    members,
                    workspaceInfo,
                },
                access: {
                    members: {
                        '*': { auth: 'user', permission: 'viewInvoices' },
                        removeMember: { auth: 'user', permission: 'deleteWorkspace' },
                    },
                    workspaceInfo: false,
                },
            })
        ).toThrow("Access cascade key 'removeMember' does not match a route or group directly under 'members'.");
    });

    it('throws on an empty oneOf, which nothing can satisfy', () => {
        const { k, members, workspaceInfo } = makeSurface();

        expect(() =>
            k.contract({
                routes: {
                    members,
                    workspaceInfo,
                },
                access: {
                    members: {
                        auth: 'user',
                        permission: {
                            oneOf: [],
                        },
                    },
                    workspaceInfo: false,
                },
            })
        ).toThrow(/is an empty 'oneOf', which no caller can satisfy/);
    });

    it('throws when a nested cascade targets a route', () => {
        const { k, members, workspaceInfo } = makeSurface();

        expect(() =>
            // @ts-expect-error a nested cascade only applies to a group
            k.contract({
                routes: {
                    members,
                    workspaceInfo,
                },
                access: {
                    members: {
                        '*': { auth: 'user', permission: 'viewInvoices' },
                        inviteMember: {
                            '*': { auth: 'user', permission: 'deleteWorkspace' },
                        },
                    },
                    workspaceInfo: false,
                },
            })
        ).toThrow(/targets a route; a nested cascade only applies to a group/);
    });
});

describe('nested groups', () => {
    const makeNested = () => {
        const k = new Kizuna({
            identities: {
                user,
            },
            permissions: {
                viewInvoices,
                deleteWorkspace,
                exportLedger,
                promoteMember,
            },
        });
        return {
            k,
            workspaceRoutes: k.routes({
                info: {
                    getWorkspace: routeDefinition('/workspace'),
                },
                members: {
                    listMembers: routeDefinition('/workspace/members'),
                    inviteMember: routeDefinition('/workspace/members/invite'),
                },
            }),
        };
    };

    it('applies the group default through a subgroup', () => {
        const { k, workspaceRoutes } = makeNested();

        k.contract({
            routes: {
                workspaceRoutes,
            },
            access: {
                workspaceRoutes: { auth: 'user', permission: 'viewInvoices' },
            },
        });

        const members = workspaceRoutes.members as Routes;
        expect(routeOf(members, 'listMembers').permissions).toEqual({ all: ['viewInvoices'] });
    });

    it('lets a subgroup carry its own cascade', () => {
        const { k, workspaceRoutes } = makeNested();

        k.contract({
            routes: {
                workspaceRoutes,
            },
            access: {
                workspaceRoutes: {
                    '*': { auth: 'user', permission: 'viewInvoices' },
                    members: {
                        '*': { auth: 'user', permission: 'viewInvoices' },
                        inviteMember: { auth: 'user', permission: 'deleteWorkspace' },
                    },
                },
            },
        });

        const info = workspaceRoutes.info as Routes;
        const members = workspaceRoutes.members as Routes;
        expect(routeOf(info, 'getWorkspace').permissions).toEqual({ all: ['viewInvoices'] });
        expect(routeOf(members, 'listMembers').permissions).toEqual({ all: ['viewInvoices'] });
        expect(routeOf(members, 'inviteMember').permissions).toEqual({ all: ['deleteWorkspace'] });
    });
});

describe('the contract', () => {
    it('carries the policies and the map', () => {
        const { k, members, workspaceInfo } = makeSurface();

        const contract = k.contract({
            routes: {
                members,
                workspaceInfo,
            },
            access: {
                members: { auth: 'user', permission: 'viewInvoices' },
                workspaceInfo: false,
            },
        });

        expect(contract.declaredPermissions).toEqual({
            viewInvoices,
            deleteWorkspace,
            exportLedger,
            promoteMember,
        });
        expect(contract.permissions).toEqual({
            members: 'viewInvoices',
            workspaceInfo: false,
        });
    });

    it('leaves routes untouched when no permissions are declared', () => {
        const k = new Kizuna();
        const routes = k.routes({
            getWorkspace: routeDefinition('/workspace'),
        });

        const contract = k.contract({
            routes: {
                workspaceInfo: routes,
            },
        });

        expect(contract.permissions).toBeUndefined();
        expect(contract.declaredPermissions).toBeUndefined();
        expect(routeOf(routes, 'getWorkspace').permissions).toBeUndefined();
    });
});

describe('permissionsReport', () => {
    it('lists every route with what it demands, and the ungated ones separately', () => {
        const { k, members, workspaceInfo } = makeSurface();

        const contract = k.contract({
            routes: {
                members,
                workspaceInfo,
            },
            access: {
                members: {
                    '*': { auth: 'user', permission: 'viewInvoices' },
                    inviteMember: { auth: 'user', permission: 'deleteWorkspace' },
                },
                workspaceInfo: {
                    '*': false,
                    transfer: { auth: 'user', permission: 'exportLedger' },
                },
            },
        });

        const report = permissionsReport(contract.routes);

        expect(report.routes).toEqual([
            {
                routeKey: 'members.listMembers',
                method: 'GET',
                path: '/workspace/members',
                requirement: { all: ['viewInvoices'] },
            },
            {
                routeKey: 'members.inviteMember',
                method: 'GET',
                path: '/workspace/members/invite',
                requirement: { all: ['deleteWorkspace'] },
            },
            {
                routeKey: 'workspaceInfo.getWorkspace',
                method: 'GET',
                path: '/workspace',
                requirement: undefined,
            },
            {
                routeKey: 'workspaceInfo.deleteWorkspace',
                method: 'GET',
                path: '/workspace/delete',
                requirement: undefined,
            },
            {
                routeKey: 'workspaceInfo.transfer',
                method: 'GET',
                path: '/workspace/transfer',
                requirement: { all: ['exportLedger'] },
            },
        ]);

        expect(report.ungated.map((entry) => entry.routeKey)).toEqual(['workspaceInfo.getWorkspace', 'workspaceInfo.deleteWorkspace']);
    });
});
