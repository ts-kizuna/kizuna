import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import { Kizuna } from '@ts-kizuna/core';
import { createHonoEndpoints, createServer } from './server.js';
import { readTestBody, testAdapterFeatures } from '../../core/src/adapter-testing/index.js';

const { k } = Kizuna.init({
    tags: Kizuna.tags({
        api: 'API',
    }),
});

describe('Hono — handler context', () => {
    it('provides the Hono Context object as c', async () => {
        const contextApp = new Hono();
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
                echo: ({ c }) => ({
                    status: 200,
                    body: {
                        url: c.req.url,
                    },
                }),
            },
        });
        createHonoEndpoints(contextApi, contextApp);

        const response = await contextApp.request('/echo');
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.url).toContain('/echo');
    });
});

testAdapterFeatures({
    name: 'hono',
    createServerApi: (contract, options) => createServer(contract).server.api(options),
    mount: (api, { responseValidation }) => {
        const app = new Hono();
        createHonoEndpoints(api, app, {
            responseValidation,
        });
        return {
            request: async ({ method, path, body, headers }) => {
                const response = await app.request(path, {
                    method,
                    body,
                    headers,
                });
                const text = await response.text();
                return {
                    status: response.status,
                    headers: response.headers,
                    body: readTestBody(text),
                    text,
                };
            },
        };
    },
});
