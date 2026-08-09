import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Kizuna } from '@ts-kizuna/core';
import { KizunaServer } from '@ts-kizuna/express';
import express from 'express';
import request from 'supertest';
import { generateOpenApi } from './generator.js';
import { openApiDocsPlugin } from './plugin.js';

const { k } = Kizuna.init({
    tags: Kizuna.tags({
        api: 'API',
    }),
    plugins: {
        openApiDocs: openApiDocsPlugin({
            info: {
                title: 'Demo API',
                version: '1.0.0',
            },
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
    const { server } = KizunaServer.init(contract);
    const api = server.api({
        router: {
            getUser: ({ params }) => ({
                status: 200,
                body: {
                    id: params.id,
                },
            }),
        },
    });
    const app = express();
    api.mount(app);
    return app;
};

describe('openApiDocsPlugin', () => {
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
        const { k: servedK } = Kizuna.init({
            tags: Kizuna.tags({
                api: 'API',
            }),
            plugins: {
                openApiDocs: openApiDocsPlugin({
                    info: {
                        title: 'No drift',
                        version: '2.0.0',
                    },
                    jsonPath: true,
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
        KizunaServer.init(servedContract)
            .server.api({
                router: {
                    ping: () => ({
                        status: 200,
                        body: {
                            ok: true,
                        },
                    }),
                },
            })
            .mount(app);

        const served = JSON.parse((await request(app).get('/openapi.json')).text);

        expect(generateOpenApi(servedContract)('json')).toEqual(served);
        expect(served.info.title).toBe('No drift');
    });

    it('says what to do when there are no options and no plugin', () => {
        const { k: bareK } = Kizuna.init({
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

        expect(() => generateOpenApi(bare)).toThrow(/install `openApiDocsPlugin`/);
    });

    it('serves the document without a UI when the page is turned off', async () => {
        const { k: specOnlyK } = Kizuna.init({
            tags: Kizuna.tags({
                api: 'API',
            }),
            plugins: {
                openApiDocs: openApiDocsPlugin({
                    info: {
                        title: 'Spec only',
                        version: '1.0.0',
                    },
                    docsPath: false,
                    jsonPath: true,
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
        KizunaServer.init(specOnly)
            .server.api({
                router: {
                    ping: () => ({
                        status: 200,
                        body: {
                            ok: true,
                        },
                    }),
                },
            })
            .mount(app);

        expect((await request(app).get('/openapi.json')).status).toBe(200);
        expect((await request(app).get('/docs')).status).toBe(404);
    });

    it('takes a custom path as well as true', async () => {
        const { k: customK } = Kizuna.init({
            tags: Kizuna.tags({
                api: 'API',
            }),
            plugins: {
                openApiDocs: openApiDocsPlugin({
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
        KizunaServer.init(custom)
            .server.api({
                router: {
                    ping: () => ({
                        status: 200,
                        body: {
                            ok: true,
                        },
                    }),
                },
            })
            .mount(app);

        expect((await request(app).get('/reference')).status).toBe(200);
        expect((await request(app).get('/spec.yaml')).status).toBe(200);
        expect((await request(app).get('/docs')).status).toBe(404);
        expect((await request(app).get('/openapi.yaml')).status).toBe(404);
    });

    it('serves the document at the paths it is given', async () => {
        const { k: jsonOnlyK } = Kizuna.init({
            tags: Kizuna.tags({
                api: 'API',
            }),
            plugins: {
                openApiDocs: openApiDocsPlugin({
                    info: {
                        title: 'Both',
                        version: '1.0.0',
                    },
                    jsonPath: true,
                    yamlPath: true,
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

        const { server } = KizunaServer.init(jsonOnly);
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
            })
            .mount(app);

        expect((await request(app).get('/openapi.json')).status).toBe(200);
        expect((await request(app).get('/openapi.yaml')).status).toBe(200);
    });
});
