import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Kizuna } from '@ts-kizuna/shared';
import { KizunaServer } from '@ts-kizuna/server/express';
import express from 'express';
import request from 'supertest';
import { generateOpenApi } from './generator.js';
import { openApiPlugin } from './plugin.js';
import { openApiPluginServer } from './server.js';

const k = new Kizuna({
    tags: Kizuna.tags({
        api: 'API',
    }),
    plugins: {
        openApi: openApiPlugin({
            info: {
                title: 'Demo API',
                version: '1.0.0',
            },
            docsPath: '/docs',
        }),
    },
});

const contract = k.contract({
    routes: k.routes('api', {
        getUser: {
            method: 'GET',
            path: '/users/:id',
            responses: {
                200: z.object({
                    id: z.string(),
                }),
            },
        },
    }),
});

const serve = () => {
    const server = new KizunaServer(contract);
    const api = server.api({
        router: {
            getUser: ({ params }) => ({
                status: 200,
                body: {
                    id: params.id,
                },
            }),
        },
        plugins: {
            openApi: openApiPluginServer(),
        },
    });
    const app = express();
    api.mount(app);
    return app;
};

describe('openApiPlugin', () => {
    it('serves the reference UI with the document embedded', async () => {
        const response = await request(serve()).get('/docs');

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toContain('text/html');
        expect(response.text).toContain('Demo API');
        expect(response.text).toContain('/users/{id}');
    });

    it('serves no document routes unless asked', async () => {
        expect((await request(serve()).get('/openapi.json')).status).toBe(404);
        expect((await request(serve()).get('/openapi.yaml')).status).toBe(404);
    });

    it('leaves the contract routes alone', async () => {
        const response = await request(serve()).get('/users/7');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            id: '7',
        });
    });

    it('keeps its own routes out of the document', () => {
        expect(Object.keys(generateOpenApi(contract)('json').paths)).toEqual(['/users/{id}']);
    });

    it('hands its options to generateOpenApi, so a build step cannot drift from what is served', async () => {
        const servedK = new Kizuna({
            tags: Kizuna.tags({
                api: 'API',
            }),
            plugins: {
                openApi: openApiPlugin({
                    info: {
                        title: 'No drift',
                        version: '2.0.0',
                    },
                    jsonPath: '/openapi.json',
                }),
            },
        });
        const servedContract = servedK.contract({
            routes: servedK.routes('api', {
                ping: {
                    method: 'GET',
                    path: '/ping',
                    responses: {
                        200: z.object({
                            ok: z.boolean(),
                        }),
                    },
                },
            }),
        });

        const app = express();
        new KizunaServer(servedContract)
            .api({
                router: {
                    ping: () => ({
                        status: 200,
                        body: {
                            ok: true,
                        },
                    }),
                },
                plugins: {
                    openApi: openApiPluginServer(),
                },
            })
            .mount(app);

        const served = JSON.parse((await request(app).get('/openapi.json')).text);

        expect(generateOpenApi(servedContract)('json')).toEqual(served);
        expect(served.info.title).toBe('No drift');
    });

    it('says what to do when there are no options and no plugin', () => {
        const bareK = new Kizuna({
            tags: Kizuna.tags({
                api: 'API',
            }),
        });
        const bare = bareK.contract({
            routes: bareK.routes('api', {
                ping: {
                    method: 'GET',
                    path: '/ping',
                    responses: {
                        200: z.object({
                            ok: z.boolean(),
                        }),
                    },
                },
            }),
        });

        expect(() => generateOpenApi(bare)).toThrow(/Install `openApiPlugin`/);
    });

    it('serves the document with no UI when only a document path is given', async () => {
        const specOnlyK = new Kizuna({
            tags: Kizuna.tags({
                api: 'API',
            }),
            plugins: {
                openApi: openApiPlugin({
                    info: {
                        title: 'Spec only',
                        version: '1.0.0',
                    },
                    jsonPath: '/openapi.json',
                }),
            },
        });
        const specOnly = specOnlyK.contract({
            routes: specOnlyK.routes('api', {
                ping: {
                    method: 'GET',
                    path: '/ping',
                    responses: {
                        200: z.object({
                            ok: z.boolean(),
                        }),
                    },
                },
            }),
        });

        const app = express();
        new KizunaServer(specOnly)
            .api({
                router: {
                    ping: () => ({
                        status: 200,
                        body: {
                            ok: true,
                        },
                    }),
                },
                plugins: {
                    openApi: openApiPluginServer(),
                },
            })
            .mount(app);

        expect((await request(app).get('/openapi.json')).status).toBe(200);
        expect((await request(app).get('/docs')).status).toBe(404);
    });

    it('takes a path for each of the three', async () => {
        const customK = new Kizuna({
            tags: Kizuna.tags({
                api: 'API',
            }),
            plugins: {
                openApi: openApiPlugin({
                    info: {
                        title: 'Custom',
                        version: '1.0.0',
                    },
                    docsPath: '/reference',
                    yamlPath: '/spec.yaml',
                }),
            },
        });
        const custom = customK.contract({
            routes: customK.routes('api', {
                ping: {
                    method: 'GET',
                    path: '/ping',
                    responses: {
                        200: z.object({
                            ok: z.boolean(),
                        }),
                    },
                },
            }),
        });

        const app = express();
        new KizunaServer(custom)
            .api({
                router: {
                    ping: () => ({
                        status: 200,
                        body: {
                            ok: true,
                        },
                    }),
                },
                plugins: {
                    openApi: openApiPluginServer(),
                },
            })
            .mount(app);

        expect((await request(app).get('/reference')).status).toBe(200);
        expect((await request(app).get('/spec.yaml')).status).toBe(200);
        expect((await request(app).get('/docs')).status).toBe(404);
        expect((await request(app).get('/openapi.yaml')).status).toBe(404);
    });

    it('serves the document at the paths it is given', async () => {
        const jsonOnlyK = new Kizuna({
            tags: Kizuna.tags({
                api: 'API',
            }),
            plugins: {
                openApi: openApiPlugin({
                    info: {
                        title: 'Both',
                        version: '1.0.0',
                    },
                    jsonPath: '/openapi.json',
                    yamlPath: '/openapi.yaml',
                }),
            },
        });
        const jsonOnly = jsonOnlyK.contract({
            routes: jsonOnlyK.routes('api', {
                ping: {
                    method: 'GET',
                    path: '/ping',
                    responses: {
                        200: z.object({
                            ok: z.boolean(),
                        }),
                    },
                },
            }),
        });

        const server = new KizunaServer(jsonOnly);
        const app = express();
        server
            .api({
                router: {
                    ping: () => ({
                        status: 200,
                        body: {
                            ok: true,
                        },
                    }),
                },
                plugins: {
                    openApi: openApiPluginServer(),
                },
            })
            .mount(app);

        expect((await request(app).get('/openapi.json')).status).toBe(200);
        expect((await request(app).get('/openapi.yaml')).status).toBe(200);
    });
});
