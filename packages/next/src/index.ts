import type { z } from 'zod';
import type { Routes, Contract, TagOptions } from '@ts-kizuna/core';
import {
    createApi as coreApi,
    type ApiWithRouter,
    type MiddlewareMap,
    type Router as CoreRouter,
    type ErrorMode,
    ROUTER_META,
    MIDDLEWARE_META,
} from '@ts-kizuna/core/adapter';
import { handleNextRequest, type Router, type NextHandlerOptions, type NextHandlerContext, type NextMiddlewareHandler } from './handler.js';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * A contract with its routes `R`, error `Mode`, and guard-error schema captured for
 * inference; tags and issue codes are widened (they don't affect handler typing).
 */
type ContractOf<R extends Routes, Mode extends ErrorMode> = Contract<R, Record<string, TagOptions>, string, Mode, z.ZodType | undefined>;

/**
 * Constraint that accepts any contract regardless of error mode or guard schema. The bare
 * `Contract` default (Problem Details, no guard schema) would reject opted-out contracts.
 */
type AnyContract = Contract<Routes, Record<string, TagOptions>, string, ErrorMode, z.ZodType | undefined>;

export type {
    RouteHandler,
    Router,
    NextHandlerOptions,
    NextHandlerContext,
    NextMiddlewareRoute,
    NextMiddlewareHandler,
} from './handler.js';
export { createMiddleware, createGuard } from './handler.js';
export { NextRequest, NextResponse } from 'next/server';

type HttpHandlers = {
    GET: HttpHandler;
    HEAD: HttpHandler;
    POST: HttpHandler;
    PUT: HttpHandler;
    PATCH: HttpHandler;
    DELETE: HttpHandler;
    OPTIONS: HttpHandler;
};
type HttpHandler = (request: NextRequest) => Promise<NextResponse>;

const _ON_ERROR: unique symbol = Symbol('ts-kizuna.next.onError');

type NextApiWithRouter = ApiWithRouter & {
    readonly [_ON_ERROR]?: NextHandlerOptions['onError'];
    readonly [MIDDLEWARE_META]?: unknown;
};

export type NextApi<R extends Routes = Routes> = R &
    ApiWithRouter & {
        readonly [_ON_ERROR]?: NextHandlerOptions['onError'];
        readonly [MIDDLEWARE_META]?: unknown;
        mount: (options?: NextHandlerOptions) => HttpHandlers;
    };

/**
 * Bind typed handler implementations to a contract.
 *
 * @example
 * export const router = createRouter(contract, {
 *     listUsers: ({ query }) => ({ status: 200, body: { users: [], total: 0 } }),
 *     createUser: ({ body }) => ({ status: 201, body: { id: '1', ...body } }),
 * });
 */
export const createRouter = <const C extends AnyContract>(_contract: C, router: Router<C>): Router<C> => router;

/**
 * Create endpoints for a Next.js App Router catch-all route.
 *
 * @example
 * // app/api/[...ts-kizuna]/route.ts
 * export const { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS } = createNextEndpoints(api, {
 *     basePath: '/api',
 * });
 */
export function createNextEndpoints(api: NextApiWithRouter, options?: NextHandlerOptions): HttpHandlers {
    const middlewareMap = api[MIDDLEWARE_META] as MiddlewareMap<Routes, NextMiddlewareHandler> | undefined;
    const handler = (request: NextRequest) =>
        handleNextRequest(request, api as unknown as Routes, api[ROUTER_META] as CoreRouter<Routes, NextHandlerContext>, middlewareMap, {
            basePath: options?.basePath,
            onError: options?.onError ?? api[_ON_ERROR],
            requestMiddleware: options?.requestMiddleware,
            responseValidation: options?.responseValidation,
        });
    return {
        GET: handler,
        HEAD: handler,
        POST: handler,
        PUT: handler,
        PATCH: handler,
        DELETE: handler,
        OPTIONS: handler,
    };
}

/**
 * Bind a contract to its router and per-route middleware.
 *
 * @example
 * export const api = createApi({
 *     contract,
 *     router,
 *     middleware,
 * });
 */
export function createApi<const R extends Routes>(options: {
    contract: ContractOf<R, 'problem-details'>;
    router: Router<ContractOf<R, 'problem-details'>>;
    middleware?: MiddlewareMap<R, NextMiddlewareHandler>;
    onError?: NextHandlerOptions['onError'];
}): NextApi<R>;
export function createApi<const R extends Routes>(options: {
    contract: ContractOf<R, 'custom'>;
    router: Router<ContractOf<R, 'custom'>>;
    middleware?: MiddlewareMap<R, NextMiddlewareHandler>;
    onError?: NextHandlerOptions['onError'];
}): NextApi<R>;
export function createApi(options: any): NextApi {
    const { contract, router, middleware, onError } = options;
    const spec = coreApi(contract.routes);
    return Object.assign(spec, {
        [ROUTER_META]: router,
        [MIDDLEWARE_META]: middleware,
        [_ON_ERROR]: onError,
        mount(mountOptions?: NextHandlerOptions) {
            return createNextEndpoints(this as unknown as NextApiWithRouter, mountOptions);
        },
    }) as unknown as NextApi;
}
