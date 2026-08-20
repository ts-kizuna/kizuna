import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { Kizuna } from '@ts-kizuna/core';
import { createPlugin, implementPlugin } from '@ts-kizuna/core/adapter';
import { KizunaServer } from './server.js';

const probePlugin = createPlugin<{ queue: (id: string) => string }>()({
    name: 'probe',
    serverModule: './plugin.test.js',
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
});

const probeServer = (config: { label: string }) =>
    implementPlugin(probePlugin, () => ({
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
    }));

const k = new Kizuna({
    tags: Kizuna.tags({
        api: 'API',
    }),
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
    plugins: {
        probe: probePlugin,
    },
    routes,
});

const serve = () => {
    const server = new KizunaServer(contract);
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
            probe: probeServer({
                label: 'probed',
            }),
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
            serverModule: './plugin.test.js',
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
        });

        const collidingK = new Kizuna({
            tags: Kizuna.tags({
                api: 'API',
            }),
        });
        // Contract time, because the plugins are on the kizuna instance that built it.
        expect(() =>
            collidingK.contract({
                plugins: {
                    collide: collidingPlugin,
                },
                routes,
            })
        ).toThrow(/collides with/);
    });
});
