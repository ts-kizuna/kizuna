import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { Kizuna } from '@ts-kizuna/core';
import { createPlugin } from '@ts-kizuna/core/adapter';
import { KizunaServer } from './server.js';

const probePlugin = createPlugin({
    name: 'probe',
    routes: {
        ping: {
            method: 'GET',
            path: '/probe/ping',
            responses: {
                200: z.object({
                    pong: z.boolean(),
                }),
            },
        },
    },
    server: (config: { label: string }) => ({
        router: {
            ping: () => ({
                status: 200 as const,
                body: {
                    pong: true,
                },
            }),
        },
        exports: {
            queue: (id: string) => `${config.label}:${id}`,
        },
    }),
});

const { k } = Kizuna.init({
    tags: Kizuna.tags({
        api: 'API',
    }),
    plugins: {
        probe: probePlugin,
    },
});

const routes = k.routes('api', {
    indexUser: {
        method: 'POST',
        path: '/users/:id/index',
        responses: {
            200: z.object({
                queued: z.string(),
            }),
        },
    },
});

const contract = k.contract({
    routes,
});

const serve = () => {
    const { server } = KizunaServer.init(contract);
    const api = server.api({
        router: {
            indexUser: ({ params, plugins }) => ({
                status: 200,
                body: {
                    queued: plugins.probe.queue(params.id),
                },
            }),
        },
        plugins: {
            probe: {
                label: 'probed',
            },
        },
    });
    const app = express();
    app.use(express.json());
    api.mount(app);
    return app;
};

describe('plugin lane', () => {
    it('serves a plugin route through api.mount', async () => {
        const response = await request(serve()).get('/probe/ping');
        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            pong: true,
        });
    });

    it('hands a plugin export to every handler under plugins', async () => {
        const response = await request(serve()).post('/users/42/index');
        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            queued: 'probed:42',
        });
    });

    it('keeps plugin routes out of contract.routes', () => {
        expect(Object.keys(contract.routes)).toEqual(['indexUser']);
    });

    it('reports a path a plugin and the contract both claim', () => {
        const collidingPlugin = createPlugin({
            name: 'collide',
            routes: {
                clash: {
                    method: 'POST',
                    path: '/users/:id/index',
                    responses: {
                        200: z.object({
                            ok: z.boolean(),
                        }),
                    },
                },
            },
            server: () => ({
                router: {
                    clash: () => ({
                        status: 200 as const,
                        body: {
                            ok: true,
                        },
                    }),
                },
            }),
        });

        const { k: collidingK } = Kizuna.init({
            tags: Kizuna.tags({
                api: 'API',
            }),
            plugins: {
                collide: collidingPlugin,
            },
        });
        const colliding = collidingK.contract({
            routes,
        });

        const { server } = KizunaServer.init(colliding);
        expect(() =>
            server.api({
                router: {
                    indexUser: () => ({
                        status: 200,
                        body: {
                            queued: 'x',
                        },
                    }),
                },
            } as never)
        ).toThrow(/Duplicate route/);
    });
});
