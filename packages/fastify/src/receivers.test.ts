import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Kizuna } from '@ts-kizuna/core';
import { KizunaServer } from './server.js';

/**
 * The shared catalogue covers every receiver behaviour. Fastify's own is scoping:
 * receivers replace the content type parser inside their own scope, which must
 * not reach the contract's routes.
 */
const k = new Kizuna();

const routes = k.routes({
    createUser: {
        method: 'POST',
        path: '/users',
        body: z.object({
            name: z.string(),
        }),
        responses: {
            201: z.object({
                name: z.string(),
            }),
        },
    },
});

const contract = k.contract({
    routes: {
        users: routes,
    },
    receivers: {
        hook: k.receiver({
            path: '/hooks/inbound',
            body: z.object({
                id: z.string(),
            }),
        }),
    },
});

const server = new KizunaServer(contract);

describe('receivers on fastify', () => {
    it('leaves the contract routes parsing JSON, because the byte parser is scoped to the receivers', async () => {
        const api = server.api({
            router: server.router({
                users: {
                    createUser: ({ body }) => ({
                        status: 201,
                        body: {
                            name: body.name,
                        },
                    }),
                },
            }),
            receivers: {
                hook: {
                    verify: () => undefined,
                    handler: () => undefined,
                },
            },
        });
        const app = Fastify();
        await api.mount(app);
        await app.ready();

        const created = await app.inject({
            method: 'POST',
            url: '/users',
            payload: {
                name: 'grace',
            },
        });
        expect(created.statusCode).toBe(201);
        expect(created.json()).toEqual({
            name: 'grace',
        });
    });
});
