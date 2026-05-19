import { expectTypeOf, test } from 'vitest';
import type { Request } from 'express';
import type { RouteDefinition } from '@ts-kizuna/core';
import { z } from 'zod';
import { createContract } from '@ts-kizuna/core';
import { createRouter } from './server.js';

const contract = createContract({
    getUser: {
        method: 'GET',
        path: '/users/:id',
        responses: {
            200: z.object({
                id: z.string(),
                name: z.string(),
            }),
            404: z.object({
                message: z.string(),
            }),
        },
    },
    createUser: {
        method: 'POST',
        path: '/users',
        body: z.object({
            name: z.string(),
            email: z.string(),
        }),
        responses: {
            201: z.object({
                id: z.string(),
                name: z.string(),
                email: z.string(),
            }),
        },
    },
});

test('handler receives typed path params', () => {
    createRouter(contract, {
        getUser: ({ params }) => {
            expectTypeOf(params).toEqualTypeOf<{ id: string }>();
            return {
                status: 200,
                body: {
                    id: params.id,
                    name: 'x',
                },
            };
        },
        createUser: ({ body }) => {
            expectTypeOf(body).toEqualTypeOf<{ name: string; email: string }>();
            return {
                status: 201,
                body: {
                    id: '1',
                    name: body.name,
                    email: body.email,
                },
            };
        },
    });
});

test('Express Request is augmented with kizunaRoute', () => {
    expectTypeOf<Request['kizunaRoute']>().toEqualTypeOf<RouteDefinition | undefined>();
});
