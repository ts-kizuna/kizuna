import { expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { createContract } from './contract.js';
import { ErrorResponse } from './error-response.js';
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
    deleteUser: {
        method: 'DELETE',
        path: '/users/:id',
        responses: {
            200: z.object({
                success: z.boolean(),
            }),
            404: ErrorResponse,
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

test('HandlerArgs error function returns never', () => {
    type ErrorFn = HandlerArgs<GetUserRoute>['error'];
    expectTypeOf<ErrorFn>().returns.toEqualTypeOf<never>();
});

test('HandlerArgs error function accepts the same union as HandlerReturn', () => {
    type ErrorParam = Parameters<HandlerArgs<GetUserRoute>['error']>[0];
    expectTypeOf<ErrorParam>().toEqualTypeOf<HandlerReturn<GetUserRoute>>();
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

type DeleteUserRoute = (typeof contract)['deleteUser'];

test('ErrorResponse body strips title and status, keeps detail required, makes type optional', () => {
    type Return = HandlerReturn<DeleteUserRoute>;
    type ErrorBody = Extract<Return, { status: 404 }>['body'];

    expectTypeOf<{ detail: string }>().toMatchTypeOf<ErrorBody>();
    expectTypeOf<{ detail: string; type: string }>().toMatchTypeOf<ErrorBody>();
});

test('ErrorResponse body rejects title and status from handler input', () => {
    type Return = HandlerReturn<DeleteUserRoute>;
    type ErrorBody = Extract<Return, { status: 404 }>['body'];

    expectTypeOf<{ title: string; detail: string }>().not.toMatchTypeOf<ErrorBody>();
    expectTypeOf<{ status: number; detail: string }>().not.toMatchTypeOf<ErrorBody>();
});
