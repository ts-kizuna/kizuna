import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Kizuna } from '@ts-kizuna/core';
import { KizunaServer } from './server.js';

const MemberSchema = z.object({
    id: z.string(),
});

const user = Kizuna.identity.bearer({
    context: z.object({
        userId: z.string(),
    }),
});

const k = new Kizuna({
    identities: {
        user,
    },
    permissions: {
        viewInvoices: Kizuna.permission(),
        exportLedger: Kizuna.permission(),
        promoteMember: Kizuna.permission({
            appliesTo: MemberSchema,
        }),
    },
    settings: {
        permissions: {
            path: '/permissions',
            identity: 'user',
        },
    },
});

const routes = k.routes({
    getWorkspace: {
        method: 'GET',
        path: '/workspace',
        responses: {
            200: z.object({
                ok: z.boolean(),
            }),
        },
    },
});

const contract = k.contract({
    routes: {
        workspace: routes,
    },
    auth: {
        workspace: 'user',
    },
    permissions: {
        workspace: 'viewInvoices',
    },
});

const server = new KizunaServer(contract);

const requireUser = server.guard('user', ({ bearer, deny }) => {
    if (bearer?.token !== 'tok_ada') return deny(401, 'Unauthorized');
    return {
        userId: '1',
    };
});

const canViewInvoices = server.permission('viewInvoices', ({ auth }) => auth.user?.userId === '1');
const canExportLedger = server.permission('exportLedger', () => false);
const canPromoteMember = server.permission('promoteMember', () => (member) => member.id === '9');

const mount = () => {
    const api = server.api({
        router: {
            workspace: {
                getWorkspace: () => ({
                    status: 200,
                    body: {
                        ok: true,
                    },
                }),
            },
        },
        guards: {
            user: requireUser,
        },
        permissions: {
            viewInvoices: canViewInvoices,
            exportLedger: canExportLedger,
            promoteMember: canPromoteMember,
        },
    });
    const app = express();
    app.use(express.json());
    api.mount(app);
    return app;
};

describe('the permissions endpoint', () => {
    it('reports every permission answerable without a record', async () => {
        const response = await request(mount()).get('/permissions').set('authorization', 'Bearer tok_ada');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            viewInvoices: true,
            exportLedger: false,
        });
    });

    it('runs the identity it declares, so an anonymous caller is refused', async () => {
        const response = await request(mount()).get('/permissions');

        expect(response.status).toBe(401);
        expect(response.body.detail).toBe('Unauthorized');
    });

    it('stays out of the contract, so the client and the generators do not see it', () => {
        expect(Object.keys(contract.routes.workspace)).toEqual(['getWorkspace']);
    });
});

describe('a contract without the endpoint', () => {
    it('serves nothing at the default path', async () => {
        const bare = new Kizuna({
            permissions: {
                viewInvoices: Kizuna.permission(),
            },
        });
        const bareRoutes = bare.routes({
            getWorkspace: {
                method: 'GET',
                path: '/workspace',
                responses: {
                    200: z.object({
                        ok: z.boolean(),
                    }),
                },
            },
        });
        const bareContract = bare.contract({
            routes: {
                workspace: bareRoutes,
            },
            permissions: {
                workspace: false,
            },
        });
        const api = new KizunaServer(bareContract).api({
            router: {
                workspace: {
                    getWorkspace: () => ({
                        status: 200,
                        body: {
                            ok: true,
                        },
                    }),
                },
            },
            permissions: {
                viewInvoices: () => true,
            },
        });
        const app = express();
        api.mount(app);

        const response = await request(app).get('/permissions');
        expect(response.status).toBe(404);
    });
});
