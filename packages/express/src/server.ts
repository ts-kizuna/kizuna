import type { Request, Response, NextFunction, Router as ExpressRouter } from 'express';
import { Router as createExpressRouter } from 'express';
import {
    type AdapterRequest,
    type RouteDefinition,
    type Contract,
    type RouteHandler as CoreRouteHandler,
    type Router as CoreRouter,
    createAdapter,
    renderJsonResult,
} from '@ts-kizuna/core/adapter';
import { createApi as coreCreateApi, type ApiDefinition } from '@ts-kizuna/core/adapter';

const _ROUTER: unique symbol = Symbol('ts-kizuna.express.router');

type ApiWithRouter = ApiDefinition & {
    readonly [_ROUTER]: Router<any>;
};

export type ExpressApi<R extends Contract = Contract> = R &
    ApiDefinition & {
        readonly [_ROUTER]: Router<any>;
    };

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
        res.status(rendered.status).send(JSON.stringify(rendered.body));
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
export function createExpressEndpoints(api: ApiWithRouter, app: AppLike, options?: ExpressOptions): ExpressRouter {
    const resolvedRouter = api[_ROUTER];
    const resolvedOptions: ExpressOptions | undefined = options;

    const expressRouter = createExpressRouter();
    for (const { routeKey, route } of adapter.eachRoute(api as unknown as Contract, resolvedRouter)) {
        const method = route.method.toLowerCase() as 'get' | 'head' | 'post' | 'put' | 'patch' | 'delete' | 'options';
        expressRouter[method](
            route.path,
            (req: Request, _res: Response, next: NextFunction) => {
                req.kizunaRoute = route;
                next();
            },
            ...((resolvedOptions?.globalMiddleware ?? []) as Array<(req: Request, res: Response, next: NextFunction) => void>),
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
                    responseValidation: resolvedOptions?.responseValidation,
                });
            }
        );
    }
    app.use(expressRouter);

    return expressRouter;
}

/**
 * Define a fully-typed Express API — routes and handlers in one call.
 *
 * ```ts
 * // src/api.ts
 * import { createApi } from '@ts-kizuna/express';
 * import { contract } from './contract';
 * import { router } from './router';
 *
 * export const api = createApi({
 *     contract,
 *     router,
 * });
 * ```
 */
export const createApi = <const R extends Contract>(options: { contract: R; router: Router<R> }): ExpressApi<R> => {
    const { contract, router } = options;
    const spec = coreCreateApi(contract);
    return Object.assign(spec, {
        [_ROUTER]: router,
    }) as unknown as ExpressApi<R>;
};
