import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { z } from 'zod';
import { kizuna, createTags } from '@ts-kizuna/core';
import { createServer, fastifyKizuna } from './server.js';
import { readTestBody, testAdapterFeatures } from '../../core/src/adapter-testing/index.js';

const { k } = kizuna({
    tags: createTags({
        api: 'API',
    }),
});

describe('Fastify — handler context', () => {
    it('provides the Fastify request and reply objects', async () => {
        const contextApp = Fastify();
        const contextRoutes = k.routes('api', {
            echo: {
                method: 'GET',
                path: '/echo',
                responses: {
                    200: z.object({
                        url: z.string(),
                    }),
                },
            },
        });
        const contextContract = k.contract({
            routes: contextRoutes,
        });
        const contextApi = createServer(contextContract).server.api({
            router: {
                echo: ({ request }) => ({
                    status: 200,
                    body: {
                        url: request.url,
                    },
                }),
            },
        });
        contextApp.register(fastifyKizuna, {
            api: contextApi,
        });
        await contextApp.ready();

        const response = await contextApp.inject({
            method: 'GET',
            url: '/echo',
        });
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.url).toContain('/echo');
    });
});

testAdapterFeatures({
    name: 'fastify',
    createServerApi: (contract, options) => createServer(contract).server.api(options),
    mount: async (api, { responseValidation }) => {
        const app = Fastify();
        await app.register(fastifyKizuna, {
            api,
            responseValidation,
        });
        await app.ready();
        return {
            close: () => app.close(),
            request: async ({ method, path, body, headers }) => {
                const response = await app.inject({
                    method,
                    url: path,
                    payload: body,
                    headers,
                });
                return {
                    status: response.statusCode,
                    headers: new Headers(response.headers as Record<string, string>),
                    body: readTestBody(response.body),
                    text: response.body,
                };
            },
        };
    },
});
