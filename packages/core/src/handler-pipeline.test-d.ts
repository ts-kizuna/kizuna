import { expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { ProblemDetailsSchema } from './error-response.js';
import type { RouteHandler, HandlerArgs, HandlerReturn, Router } from './handler-pipeline.js';
import { Kizuna } from './kizuna.js';

const k = new Kizuna({
    tags: Kizuna.tags({
        api: 'API',
    }),
});

const contractRoutes = k.routes('api', {
    getUser: {
        method: 'GET',
        path: '/users/:id',
        responses: {
            200: z.object({
                id: z.string(),
                name: z.string(),
            }),
            404: ProblemDetailsSchema,
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
            409: ProblemDetailsSchema.extend({
                conflictingId: z.string(),
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
            404: ProblemDetailsSchema,
        },
    },
});

type GetUserRoute = (typeof contractRoutes)['getUser'];
type CreateUserRoute = (typeof contractRoutes)['createUser'];

test('HandlerReturn discriminates over literal status codes; success bodies pass through, error bodies are Problem Details', () => {
    type Return = HandlerReturn<GetUserRoute>;
    expectTypeOf<Extract<Return, { status: 200 }>['body']>().toEqualTypeOf<{ id: string; name: string }>();
    // 404 is an error status: the envelope is stripped to `detail` (+ optional `type`).
    expectTypeOf<{ detail: string }>().toMatchTypeOf<Extract<Return, { status: 404 }>['body']>();
});

test('HandlerReturn rejects status codes not in the contract', () => {
    expectTypeOf<{ status: 500; body: { detail: string } }>().not.toMatchTypeOf<HandlerReturn<GetUserRoute>>();
});

test('HandlerReturn rejects body that does not match the status', () => {
    expectTypeOf<{ status: 200; body: { detail: string } }>().not.toMatchTypeOf<HandlerReturn<GetUserRoute>>();
    expectTypeOf<{ status: 404; body: { id: string; name: string } }>().not.toMatchTypeOf<HandlerReturn<GetUserRoute>>();
});

test('error statuses (4xx/5xx) require a Problem Details schema — non-envelope shapes resolve to never', () => {
    const customErrorContractRoutes = k.routes('api', {
        getThing: {
            method: 'GET',
            path: '/things/:id',
            responses: {
                200: z.object({
                    id: z.string(),
                }),
                404: z.object({
                    message: z.string(),
                }),
                500: z.object({
                    oops: z.string(),
                }),
            },
        },
    });

    type Route = (typeof customErrorContractRoutes)['getThing'];
    // Success status keeps its custom shape.
    expectTypeOf<Extract<HandlerReturn<Route>, { status: 200 }>['body']>().toEqualTypeOf<{ id: string }>();
    // 4xx and 5xx with a non-Problem-Details schema are unconstructable.
    expectTypeOf<Extract<HandlerReturn<Route>, { status: 404 }>['body']>().toEqualTypeOf<never>();
    expectTypeOf<Extract<HandlerReturn<Route>, { status: 500 }>['body']>().toEqualTypeOf<never>();
});

test('Problem Details extension members surface on the handler body', () => {
    type Return = HandlerReturn<CreateUserRoute>;
    type ConflictBody = Extract<Return, { status: 409 }>['body'];
    expectTypeOf<{ detail: string; conflictingId: string }>().toMatchTypeOf<ConflictBody>();
    // `detail` and the extension are required; envelope fields stay auto-filled.
    expectTypeOf<{ conflictingId: string }>().not.toMatchTypeOf<ConflictBody>();
});

test('HandlerArgs surfaces typed body when the route declares it', () => {
    expectTypeOf<HandlerArgs<CreateUserRoute>['body']>().toEqualTypeOf<{ name: string; email: string }>();
    expectTypeOf<HandlerArgs<GetUserRoute>['body']>().toEqualTypeOf<undefined>();
});

test('HandlerArgs throwError returns never', () => {
    type ThrowErrorFn = HandlerArgs<GetUserRoute>['throwError'];
    expectTypeOf<ThrowErrorFn>().returns.toEqualTypeOf<never>();
});

test('HandlerArgs throwError accepts the same union as HandlerReturn', () => {
    type ThrowErrorParam = Parameters<HandlerArgs<GetUserRoute>['throwError']>[0];
    expectTypeOf<ThrowErrorParam>().toEqualTypeOf<HandlerReturn<GetUserRoute>>();
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
    type Implementation = Router<typeof contractRoutes, { request: Request }>;
    expectTypeOf<Implementation['getUser']>().parameter(0).toMatchTypeOf<{ params: { id: string }; request: Request }>();
    expectTypeOf<Implementation['createUser']>().parameter(0).toMatchTypeOf<{ body: { name: string; email: string } }>();
});

type DeleteUserRoute = (typeof contractRoutes)['deleteUser'];

test('ProblemDetailsSchema body strips title and status, keeps detail required, makes type optional', () => {
    type Return = HandlerReturn<DeleteUserRoute>;
    type ErrorBody = Extract<Return, { status: 404 }>['body'];

    expectTypeOf<{ detail: string }>().toMatchTypeOf<ErrorBody>();
    expectTypeOf<{ detail: string; type: string }>().toMatchTypeOf<ErrorBody>();
});

test('ProblemDetailsSchema body rejects title and status from handler input', () => {
    type Return = HandlerReturn<DeleteUserRoute>;
    type ErrorBody = Extract<Return, { status: 404 }>['body'];

    expectTypeOf<{ title: string; detail: string }>().not.toMatchTypeOf<ErrorBody>();
    expectTypeOf<{ status: number; detail: string }>().not.toMatchTypeOf<ErrorBody>();
});
