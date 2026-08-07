import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createMiddleware as createHonoMiddleware } from 'hono/factory';
import { z } from 'zod';
import { kizuna, createTags } from '@ts-kizuna/core';
import { createApi, createHonoEndpoints, createServer } from './server.js';
import { readTestBody, sessionAuthorization, testAdapterFeatures } from '../../core/src/adapter-testing/index.js';

const { k } = kizuna({
    tags: createTags({
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
        const contextApi = createApi({
            contract: contextContract,
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

const honoRequireAuth = createHonoMiddleware(async (c, next) => {
    if (c.req.header('authorization') !== sessionAuthorization) {
        return c.json(
            {
                detail: 'Unauthorized',
            },
            401
        );
    }
    await next();
});

testAdapterFeatures({
    name: 'hono',
    createApi,
    createServerApi: (contract, options) => createServer(contract).server.api(options),
    requireAuth: honoRequireAuth,
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
