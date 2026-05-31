import type { Contract, MiddlewareMap } from '@ts-kizuna/core';
import { createApi as coreCreateApi, type ApiWithRouter, ROUTER_META, MIDDLEWARE_META } from '@ts-kizuna/core/adapter';
import { handleNextRequest, type Router, type NextHandlerOptions, type NextMiddlewareHandler } from './handler.js';
import { type NextRequest, NextResponse } from 'next/server';

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
export { createServerAction, type ServerActionOptions, type ServerActionResult } from './action.js';
export { isValidationError, type ValidationError } from '@ts-kizuna/core';

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

export type NextApi<R extends Contract = Contract> = R &
    ApiWithRouter & {
        readonly [_ON_ERROR]?: NextHandlerOptions['onError'];
        readonly [MIDDLEWARE_META]?: unknown;
        mount: (options?: NextHandlerOptions) => HttpHandlers;
    };

/**
 * Bind typed handler implementations to a contract.
 *
 * ```ts
 * // lib/router.ts
 * import { createRouter } from '@ts-kizuna/next';
 * import { contract } from './contract';
 *
 * export const router = createRouter(contract, {
 *     listUsers: ({ query }) => ({ status: 200, body: { users: [], total: 0 } }),
 *     createUser: ({ body }) => ({ status: 201, body: { id: '1', ...body } }),
 * });
 * ```
 */
export const createRouter = <T extends Contract>(_contract: T, router: Router<T>): Router<T> => router;

/**
 * Create endpoints for a Next.js App Router catch-all route.
 *
 * ```ts
 * // app/api/[...ts-kizuna]/route.ts
 * import { createNextEndpoints } from '@ts-kizuna/next';
 * import { api } from '../../lib/api';
 *
 * export const { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS } = createNextEndpoints(api, {
 *     basePath: '/api',
 * });
 * ```
 */
export function createNextEndpoints(api: NextApiWithRouter, options?: NextHandlerOptions): HttpHandlers {
    const middlewareMap = api[MIDDLEWARE_META] as MiddlewareMap<Contract, NextMiddlewareHandler> | undefined;
    const handler = (request: NextRequest) =>
        handleNextRequest(request, api as unknown as Contract, api[ROUTER_META] as Router<Contract>, middlewareMap, {
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
 * Define a fully-typed Next.js API — routes and handlers in one call.
 *
 * ```ts
 * // lib/api.ts
 * import { createApi } from '@ts-kizuna/next';
 * import { contract } from './contract';
 * import { handlers } from './handlers';
 *
 * export const api = createApi({
 *     contract,
 *     router,
 * });
 * ```
 *
 * ```ts
 * // app/api/[...ts-kizuna]/route.ts
 * import { createNextEndpoints } from '@ts-kizuna/next';
 * import { api } from '../../lib/api';
 *
 * export const { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS } = createNextEndpoints(api, {
 *     basePath: '/api',
 * });
 * ```
 */
export const createApi = <const R extends Contract>(options: {
    contract: R;
    router: Router<R>;
    middleware?: MiddlewareMap<R, NextMiddlewareHandler>;
    onError?: NextHandlerOptions['onError'];
}): NextApi<R> => {
    const { contract, router, middleware, onError } = options;
    const spec = coreCreateApi(contract);
    return Object.assign(spec, {
        [ROUTER_META]: router,
        [MIDDLEWARE_META]: middleware,
        [_ON_ERROR]: onError,
        mount(mountOptions?: NextHandlerOptions) {
            return createNextEndpoints(this as unknown as NextApiWithRouter, mountOptions);
        },
    }) as unknown as NextApi<R>;
};
