import type { z } from 'zod';
import type { Routes, Contract, TagOptions, SecurityScheme, RequestContextSchema, GuardParams } from '@ts-kizuna/core';
import {
    createApi as coreApi,
    type ApiWithRouter,
    type GuardMap,
    type GuardRun,
    type MiddlewareMap,
    type RequestContextMap,
    type RequestContextRun,
    type Router as CoreRouter,
    ROUTER_META,
    GUARDS_META,
    SCHEMES_META,
    REQUEST_CONTEXT_META,
    MIDDLEWARE_META,
} from '@ts-kizuna/core/adapter';
import {
    handleNextRequest,
    type Router,
    type GuardFns,
    type GuardsForSchemes,
    type RequestResolverFns,
    type NextHandlerOptions,
    type NextHandlerContext,
    type NextMiddlewareHandler,
} from './handler.js';
import { type NextRequest, NextResponse } from 'next/server';

export type {
    RouteHandler,
    Router,
    NextHandlerOptions,
    NextHandlerContext,
    NextMiddlewareRoute,
    NextMiddlewareHandler,
} from './handler.js';
export { createGuard, createMiddleware, createRequestContextResolver } from './handler.js';
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
    readonly [GUARDS_META]?: unknown;
    readonly [SCHEMES_META]?: unknown;
    readonly [REQUEST_CONTEXT_META]?: unknown;
    readonly [MIDDLEWARE_META]?: unknown;
};

export type NextApi<R extends Routes = Routes> = R &
    ApiWithRouter & {
        readonly [_ON_ERROR]?: NextHandlerOptions['onError'];
        readonly [GUARDS_META]?: unknown;
        readonly [SCHEMES_META]?: unknown;
        readonly [REQUEST_CONTEXT_META]?: unknown;
        readonly [MIDDLEWARE_META]?: unknown;
        mount: (options?: NextHandlerOptions) => HttpHandlers;
    };

/**
 * Bind typed handler implementations to a contract, one of its route groups
 * (pass the group key as the second argument), or a bare route group.
 *
 * @deprecated Use `server.router(group, handlers)` from {@link createServer}. The
 * contract is bound once, so the group name and handlers carry through to
 * `server.api` without re-keying.
 *
 * @example
 * export const router = createRouter(contract, {
 *     listUsers: ({ query }) => ({ status: 200, body: { users: [], total: 0 } }),
 *     createUser: ({ body }) => ({ status: 201, body: { id: '1', ...body } }),
 * });
 */
export const createRouter: {
    <const C extends Contract, const Group extends Extract<keyof Router<C>, string>>(
        source: C,
        group: Group,
        router: Router<C>[Group]
    ): Router<C>[Group];
    <const C extends Contract | Routes>(source: C, router: Router<C>): Router<C>;
} = (_source: unknown, groupOrRouter: unknown, groupRouter?: unknown) => (groupRouter ?? groupOrRouter) as never;

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
    const guards = api[GUARDS_META] as GuardMap<NextHandlerContext> | undefined;
    const schemes = api[SCHEMES_META] as Record<string, SecurityScheme> | undefined;
    const requestContext = api[REQUEST_CONTEXT_META] as RequestContextMap<NextHandlerContext> | undefined;
    const middlewareMap = api[MIDDLEWARE_META] as MiddlewareMap<Routes, NextMiddlewareHandler> | undefined;
    const handler = (request: NextRequest) =>
        handleNextRequest(
            request,
            api as unknown as Routes,
            api[ROUTER_META] as CoreRouter<Routes, NextHandlerContext>,
            {
                basePath: options?.basePath,
                onError: options?.onError ?? api[_ON_ERROR],
                requestMiddleware: options?.requestMiddleware,
                responseValidation: options?.responseValidation,
            },
            guards,
            schemes,
            requestContext,
            middlewareMap
        );
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
 * Bind a contract to its router and a guard per identity.
 *
 * @example
 * export const api = createApi({
 *     contract,
 *     router,
 *     guards: {
 *         user: requireUser,
 *     },
 * });
 *
 * @deprecated Use `server.api` from {@link createServer}, which binds the contract.
 */
export const createApi = <
    const R extends Routes,
    Schemes extends Record<string, SecurityScheme>,
    Auth,
    RequestContext extends Record<string, RequestContextSchema>,
>(
    options: {
        contract: Contract<R, Record<string, TagOptions>, string, Schemes, Auth, RequestContext>;
        router: Router<Contract<R, Record<string, TagOptions>, string, Schemes, Auth, RequestContext>>;
        guards?: NoInfer<GuardsForSchemes<Schemes>>;
        /**
         * Per-route middleware, in the same shape as the contract's routes.
         *
         * @deprecated Define auth with identities + the contract's `auth` map and
         * pass `guards` instead. See /docs/auth.
         */
        middleware?: MiddlewareMap<R, NextMiddlewareHandler>;
        onError?: NextHandlerOptions['onError'];
    } & (string extends keyof RequestContext
        ? { requestContext?: undefined }
        : { requestContext: NoInfer<{ [Name in keyof RequestContext]: RequestContextRun<NextHandlerContext> }> })
): NextApi<R> => {
    const { contract, router, guards, requestContext, middleware, onError } = options;
    const spec = coreApi(contract.routes);
    return Object.assign(spec, {
        [ROUTER_META]: router,
        [GUARDS_META]: guards,
        [SCHEMES_META]: contract.securitySchemes,
        [REQUEST_CONTEXT_META]: requestContext,
        [MIDDLEWARE_META]: middleware,
        [_ON_ERROR]: onError,
        mount(mountOptions?: NextHandlerOptions) {
            return createNextEndpoints(this as unknown as NextApiWithRouter, mountOptions);
        },
    }) as unknown as NextApi<R>;
};

type ServerContract<
    R extends Routes,
    Schemes extends Record<string, SecurityScheme>,
    Auth,
    RequestContext extends Record<string, RequestContextSchema>,
> = Contract<R, Record<string, TagOptions>, string, Schemes, Auth, RequestContext>;

export interface Server<
    R extends Routes,
    Schemes extends Record<string, SecurityScheme>,
    Auth,
    RequestContext extends Record<string, RequestContextSchema>,
> {
    /**
     * Define a guard for one of the contract's identities.
     */
    guard<const Name extends Extract<keyof Schemes, string>>(
        name: Name,
        run: GuardFns<Schemes, GuardParams<R, Auth, Name>>[Name]
    ): GuardRun<NextHandlerContext>;
    /**
     * Define a request context resolver declared on the contract.
     */
    requestContext<const Name extends Extract<keyof RequestContext, string>>(
        name: Name,
        run: RequestResolverFns<RequestContext>[Name]
    ): RequestContextRun<NextHandlerContext>;
    /**
     * Bind typed handlers to the contract or one of its route groups.
     */
    router: {
        <const Group extends Extract<keyof Router<ServerContract<R, Schemes, Auth, RequestContext>>, string>>(
            group: Group,
            router: Router<ServerContract<R, Schemes, Auth, RequestContext>>[Group]
        ): Router<ServerContract<R, Schemes, Auth, RequestContext>>[Group];
        (router: Router<ServerContract<R, Schemes, Auth, RequestContext>>): Router<ServerContract<R, Schemes, Auth, RequestContext>>;
    };
    /**
     * Assemble the router and guards into the api object.
     */
    api(
        options: {
            router: Router<ServerContract<R, Schemes, Auth, RequestContext>>;
            guards?: NoInfer<GuardsForSchemes<Schemes>>;
            middleware?: MiddlewareMap<R, NextMiddlewareHandler>;
            onError?: NextHandlerOptions['onError'];
        } & (string extends keyof RequestContext
            ? { requestContext?: undefined }
            : { requestContext: NoInfer<{ [Name in keyof RequestContext]: RequestContextRun<NextHandlerContext> }> })
    ): NextApi<R>;
}

/**
 * Bind a contract to a server handle: the server-side counterpart to `kizuna`'s
 * `k`.
 *
 * @example
 * const { server } = createServer(contract);
 *
 * const requireUser = server.guard('user', ({ bearer, deny }) => {
 *     const session = bearer && sessions.get(bearer.token);
 *     return session ? { userId: session.userId } : deny(401, 'Unauthorized');
 * });
 *
 * export const api = server.api({
 *     router,
 *     guards: {
 *         user: requireUser,
 *     },
 * });
 */
export const createServer = <
    const R extends Routes,
    Schemes extends Record<string, SecurityScheme>,
    Auth,
    RequestContext extends Record<string, RequestContextSchema>,
>(
    contract: ServerContract<R, Schemes, Auth, RequestContext>
): { server: Server<R, Schemes, Auth, RequestContext> } => {
    const server = {
        guard: (_name: string, run: unknown) => run,
        requestContext: (_name: string, run: unknown) => run,
        router: (groupOrRouter: unknown, groupRouter?: unknown) => groupRouter ?? groupOrRouter,
        api: (options: object) => createApi({ contract, ...options } as never),
    };
    return { server: server as unknown as Server<R, Schemes, Auth, RequestContext> };
};
