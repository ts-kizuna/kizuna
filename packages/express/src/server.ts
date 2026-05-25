import type { Request, Response, NextFunction, RequestHandler, Router as ExpressRouter } from 'express';
import { Router as createExpressRouter } from 'express';
import {
    type AdapterRequest,
    type RouteDefinition,
    type Contract,
    type MiddlewareMap,
    type RouteHandler as CoreRouteHandler,
    type Router as CoreRouter,
    type ApiWithRouter,
    ROUTER_META,
    MIDDLEWARE_META,
    createAdapter,
    resolveMiddleware,
    renderJsonResult,
    createApi as coreCreateApi,
} from '@ts-kizuna/core/adapter';

export type ExpressApi<R extends Contract = Contract> = R & ApiWithRouter & { readonly [MIDDLEWARE_META]?: unknown };

export interface ExpressHandlerContext {
    req: Request;
    res: Response;
}

export type RouteHandler<R extends RouteDefinition> = CoreRouteHandler<R, ExpressHandlerContext>;
export type Router<T extends Contract> = CoreRouter<T, ExpressHandlerContext>;

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            kizunaRoute?: RouteDefinition;
        }
    }
}

export interface ExpressOptions {
    /**
     * Middleware inserted after `req.kizunaRoute` is set, before the route handler runs.
     *
     * @deprecated Use `middleware` via `createApi` instead.
     */
    globalMiddleware?: Array<(req: Request & { kizunaRoute: RouteDefinition }, res: Response, next: NextFunction) => void>;
    /**
     * Validate handler return values against the contract's response schemas.
     * Mismatches surface as 500 errors. Intended for development; disable in production.
     *
     * @default false
     */
    responseValidation?: boolean;
}

/**
 * Bind typed handler implementations to a contract.
 *
 * ```ts
 * // src/router.ts
 * import { createRouter } from '@ts-kizuna/express';
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
 * Declare per-route middleware in the same shape as the contract.
 *
 * ```ts
 * import { createMiddleware } from '@ts-kizuna/express';
 * import { contract } from './contract';
 *
 * export const middleware = createMiddleware(contract, {
 *     listUsers: [authenticate],
 *     createUser: [authenticate, adminOnly],
 * });
 * ```
 */
export const createMiddleware = <T extends Contract>(
    _contract: T,
    map: MiddlewareMap<T, RequestHandler>
): MiddlewareMap<T, RequestHandler> => map;

type Deny = (status: number, message: string) => { status: number; message: string };

const deny: Deny = (status, message) => ({
    status,
    message,
});

/**
 * Create a guard — a middleware that checks access before the handler runs.
 *
 * Call `deny(status, message)` to reject the request.
 * Return without calling `deny` to allow it through.
 *
 * ```ts
 * import { createGuard } from '@ts-kizuna/express';
 *
 * const requireAdmin = createGuard(async (req, res, deny) => {
 *     if (req.user.role !== 'admin') {
 *         return deny(403, 'Forbidden');
 *     }
 * });
 * ```
 */
export function createGuard(
    guard: (request: Request, response: Response, deny: Deny) => Promise<ReturnType<Deny> | void> | ReturnType<Deny> | void
): RequestHandler {
    return async (request, response, next) => {
        const result = await guard(request, response, deny);
        if (result && typeof result === 'object' && 'status' in result) {
            response.status(result.status).json({
                message: result.message,
            });
            return;
        }
        next();
    };
}

export interface AppLike {
    use: (router: ExpressRouter) => unknown;
}

interface ExpressResponseContext {
    res: Response;
    next: NextFunction;
}

const adapter = createAdapter<Request, void, ExpressHandlerContext, ExpressResponseContext>({
    buildHandlerContext: (adapterRequest, { res }) => ({
        req: adapterRequest.request,
        res,
    }),
    respond: (result, { res, next }) => {
        if (result.kind === 'handler-error') {
            next(result.error);
            return;
        }
        if (result.kind === 'raw-response') {
            return;
        }
        if (res.headersSent) return;
        if (result.kind === 'not-found' || result.kind === 'method-not-allowed') {
            next();
            return;
        }
        const rendered = renderJsonResult(result);
        for (const [key, value] of Object.entries(rendered.headers)) {
            res.setHeader(key, value);
        }
        if (rendered.body === undefined) {
            res.status(rendered.status).end();
        } else {
            res.status(rendered.status).json(rendered.body);
        }
    },
});

/**
 * Mount a ts-kizuna API onto an Express app.
 *
 * ```ts
 * // src/index.ts
 * import { createExpressEndpoints } from '@ts-kizuna/express';
 * import { api } from './api';
 *
 * createExpressEndpoints(api, app);
 * ```
 */
export function createExpressEndpoints(api: ExpressApi, app: AppLike, options?: ExpressOptions): ExpressRouter {
    const resolvedRouter = api[ROUTER_META] as Router<Contract>;
    const middlewareMap = api[MIDDLEWARE_META] as MiddlewareMap<Contract, RequestHandler> | undefined;

    const expressRouter = createExpressRouter();
    for (const { routeKey, route } of adapter.eachRoute(api as unknown as Contract, resolvedRouter)) {
        const method = route.method.toLowerCase() as 'get' | 'head' | 'post' | 'put' | 'patch' | 'delete' | 'options';
        const routeMiddleware = resolveMiddleware(routeKey, middlewareMap);
        expressRouter[method](
            route.path,
            (req: Request, _res: Response, next: NextFunction) => {
                req.kizunaRoute = route;
                next();
            },
            ...routeMiddleware,
            ...((options?.globalMiddleware ?? []) as Array<(req: Request, res: Response, next: NextFunction) => void>),
            async (req: Request, res: Response, next: NextFunction) => {
                const adapterRequest: AdapterRequest<Request> = {
                    request: req,
                    method: req.method,
                    resolution: {
                        kind: 'pre-resolved',
                        routeKey,
                        route,
                        params: req.params as Record<string, string>,
                    },
                    query: req.query,
                    headers: req.headers,
                    readBody: () => req.body,
                };
                await adapter.handle({
                    contract: api as unknown as Contract,
                    router: resolvedRouter,
                    request: adapterRequest,
                    responseContext: {
                        res,
                        next,
                    },
                    responseValidation: options?.responseValidation,
                });
            }
        );
    }
    app.use(expressRouter);

    return expressRouter;
}

/**
 * Define a fully-typed Express API — routes, handlers, and middleware in one call.
 *
 * ```ts
 * // src/api.ts
 * import { createApi } from '@ts-kizuna/express';
 * import { contract } from './contract';
 * import { router } from './router';
 * import { middleware } from './middleware';
 *
 * export const api = createApi({
 *     contract,
 *     router,
 *     middleware,
 * });
 * ```
 */
export const createApi = <const R extends Contract>(options: {
    contract: R;
    router: Router<R>;
    middleware?: MiddlewareMap<R, RequestHandler>;
}): ExpressApi<R> => {
    const { contract, router, middleware } = options;
    const spec = coreCreateApi(contract);
    return Object.assign(spec, {
        [ROUTER_META]: router,
        [MIDDLEWARE_META]: middleware,
    }) as unknown as ExpressApi<R>;
};
