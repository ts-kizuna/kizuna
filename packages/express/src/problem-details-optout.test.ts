import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { kizuna } from '@ts-kizuna/core';
import { createApi, createExpressEndpoints, createGuard, createMiddleware } from './server.js';

const ApiErrorSchema = z.object({
    code: z.string(),
    message: z.string(),
});

const { k } = kizuna({
    problemDetails: false,
    guardErrorSchema: ApiErrorSchema,
});

const contract = k.contract({
    routes: k.routes({
        getThing: {
            method: 'GET',
            path: '/things/:id',
            responses: {
                200: z.object({
                    id: z.string(),
                }),
                404: ApiErrorSchema,
            },
        },
        secret: {
            method: 'GET',
            path: '/secret',
            responses: {
                200: z.object({
                    ok: z.boolean(),
                }),
            },
        },
    }),
});

const requireAuth = createGuard(contract, ({ req, deny }) => {
    if (req.headers.authorization !== 'Bearer valid') {
        return deny(401, {
            code: 'unauthorized',
            message: 'Bring a token',
        });
    }
});

const createTestApp = () => {
    const app = express();
    app.use(express.json());
    const api = createApi({
        contract,
        router: {
            getThing: ({ params }) => {
                if (params.id === 'missing') {
                    return {
                        status: 404,
                        body: {
                            code: 'not_found',
                            message: 'No such thing',
                        },
                    };
                }
                return {
                    status: 200,
                    body: {
                        id: params.id,
                    },
                };
            },
            secret: () => ({
                status: 200,
                body: {
                    ok: true,
                },
            }),
        },
        middleware: createMiddleware(contract, {
            getThing: [],
            secret: [requireAuth],
        }),
    });
    createExpressEndpoints(api, app);
    return app;
};

describe('Problem Details opt-out — Express', () => {
    const app = createTestApp();

    it('sends a handler error body verbatim as application/json', async () => {
        const response = await request(app).get('/things/missing');
        expect(response.status).toBe(404);
        expect(response.headers['content-type']).toContain('application/json');
        expect(response.headers['content-type']).not.toContain('problem+json');
        expect(response.body).toEqual({
            code: 'not_found',
            message: 'No such thing',
        });
    });

    it('renders a guard deny(status, body) as the custom shape', async () => {
        const response = await request(app).get('/secret');
        expect(response.status).toBe(401);
        expect(response.headers['content-type']).toContain('application/json');
        expect(response.headers['content-type']).not.toContain('problem+json');
        expect(response.body).toEqual({
            code: 'unauthorized',
            message: 'Bring a token',
        });
    });

    it('still emits RFC 9457 Problem Details for framework errors (406 content negotiation)', async () => {
        // Routing 404/405 are delegated to Express via next(); content negotiation is
        // rendered by kizuna and must stay Problem Details even in an opted-out contract.
        const notAcceptable = await request(app).get('/things/1').set('accept', 'text/html');
        expect(notAcceptable.status).toBe(406);
        expect(notAcceptable.headers['content-type']).toContain('application/problem+json');
        expect(notAcceptable.body).toMatchObject({
            type: 'about:blank',
            title: 'Not Acceptable',
            status: 406,
        });
    });

    it('lets an authorized request through the guard', async () => {
        const response = await request(app).get('/secret').set('authorization', 'Bearer valid');
        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            ok: true,
        });
    });
});
