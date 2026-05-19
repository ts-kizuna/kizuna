import { expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { createContract } from './contract.js';
import type { RouteHandler, HandlerArgs, HandlerReturn, Router } from './handler-pipeline.js';

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
            }),
            400: z.object({
                error: z.string(),
            }),
        },
    },
});

type GetUserRoute = (typeof contract)['getUser'];
type CreateUserRoute = (typeof contract)['createUser'];

test('HandlerReturn is a discriminated union over literal status codes', () => {
    expectTypeOf<HandlerReturn<GetUserRoute>>().toEqualTypeOf<
        | {
              status: 200;
              body: { id: string; name: string };
              headers?: Record<string, string>;
          }
        | {
              status: 404;
              body: { message: string };
              headers?: Record<string, string>;
          }
    >();
});

test('HandlerReturn rejects status codes not in the contract', () => {
    expectTypeOf<{ status: 500; body: { id: string; name: string } }>().not.toMatchTypeOf<HandlerReturn<GetUserRoute>>();
});

test('HandlerReturn rejects body that does not match the status', () => {
    expectTypeOf<{ status: 200; body: { message: string } }>().not.toMatchTypeOf<HandlerReturn<GetUserRoute>>();
    expectTypeOf<{ status: 404; body: { id: string; name: string } }>().not.toMatchTypeOf<HandlerReturn<GetUserRoute>>();
});

test('HandlerArgs surfaces typed body when the route declares it', () => {
    expectTypeOf<HandlerArgs<CreateUserRoute>['body']>().toEqualTypeOf<{ name: string; email: string }>();
    expectTypeOf<HandlerArgs<GetUserRoute>['body']>().toEqualTypeOf<undefined>();
});

test('HandlerArgs surfaces typed path params', () => {
    expectTypeOf<HandlerArgs<GetUserRoute>['params']>().toEqualTypeOf<{ id: string }>();
});

test('RouteHandler accepts HandlerContext', () => {
    type Args = Parameters<RouteHandler<GetUserRoute, { request: Request }>>[0];
    expectTypeOf<Args['request']>().toEqualTypeOf<Request>();
    expectTypeOf<Args['params']>().toEqualTypeOf<{ id: string }>();
});

test('Router maps every route key to a RouteHandler', () => {
    type Implementation = Router<typeof contract, { request: Request }>;
    expectTypeOf<Implementation['getUser']>().parameter(0).toMatchTypeOf<{ params: { id: string }; request: Request }>();
    expectTypeOf<Implementation['createUser']>().parameter(0).toMatchTypeOf<{ body: { name: string; email: string } }>();
});
