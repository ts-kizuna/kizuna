import type { Request, Response, NextFunction, RequestHandler, Router as ExpressRouter } from 'express';
import { Router as createExpressRouter } from 'express';
import {
    type AdapterRequest,
    type RouteDefinition,
    type Routes,
    type MiddlewareMap,
    type RouteHandler as CoreRouteHandler,
    type Router as CoreRouter,
    type ApiWithRouter,
    type ErrorFormatter,
    ROUTER_META,
    MIDDLEWARE_META,
    createAdapter,
    resolveMiddleware,
    renderJsonResult,
    createApi as coreApi,
    problemDetails,
} from '@ts-kizuna/core/adapter';
import type { Contract, TagOptions } from '@ts-kizuna/core';

export type ExpressApi<R extends Routes = Routes> = R & ApiWithRouter & { readonly [MIDDLEWARE_META]?: unknown };

/**
 * The Express request and response passed to each handler.
 */
export interface ExpressHandlerContext {
    req: Request;
    res: Response;
}

/**
 * The handler for a single route, typed against its contract definition.
 */
export type RouteHandler<R extends RouteDefinition> = CoreRouteHandler<R, ExpressHandlerContext>;

/**
 * The handler tree for a contract or route group, typed against it.
 */
export type Router<C> =
    C extends Contract<infer R, infer _Tags, infer _Codes>
        ? CoreRouter<R, ExpressHandlerContext>
        : C extends Routes
          ? CoreRouter<C, ExpressHandlerContext>
          : never;

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
     * Express middleware inserted after `req.kizunaRoute` is set and before the
     * route handler runs.
     *
     * @deprecated Declare per-route middleware via `createMiddleware` and `createApi` instead.
     */
    globalMiddleware?: Array<(req: Request & { kizunaRoute: RouteDefinition }, res: Response, next: NextFunction) => void>;
    /**
     * Validate handler return values against the route's response schemas.
     * Mismatches surface as 500 errors. Enable in development.
     *
     * @default false
     */
    responseValidation?: boolean;
    /**
     * Reshape error (status >= 400) response bytes before they are sent. See
     * {@link ErrorFormatter}.
     */
    formatError?: ErrorFormatter<Request>;
}

/**
 * Bind typed handler implementations to a contract or route group.
 *
 * @example
 * export const router = createRouter(contract, {
 *     listUsers: ({ query }) => ({ status: 200, body: { users: [], total: 0 } }),
 *     createUser: ({ body }) => ({ status: 201, body: { id: '1', ...body } }),
 * });
 */
export const createRouter = <const R extends Routes>(
    _source: Contract<R, Record<string, TagOptions>, string> | R,
    router: Router<R>
): Router<R> => router;

/**
 * Declare per-route middleware in the same shape as the contract's or group's routes.
 *
 * @example
 * export const middleware = createMiddleware(contract, {
 *     listUsers: [authenticate],
 *     createUser: [authenticate, adminOnly],
 * });
 */
export const createMiddleware = <const R extends Routes>(
    _source: Contract<R, Record<string, TagOptions>, string> | R,
    map: MiddlewareMap<R, RequestHandler>
): MiddlewareMap<R, RequestHandler> => map;

type Deny = (status: number, detail: string) => { status: number; detail: string };

const deny: Deny = (status, detail) => ({
    status,
    detail,
});

/**
 * Create a guard — a middleware that checks access before the handler runs. Call
 * `deny(status, detail)` to reject the request; return without calling it to allow.
 *
 * @example
 * const requireAdmin = createGuard(async ({ req, deny }) => {
 *     if (req.user?.role !== 'admin') return deny(403, 'Forbidden');
 * });
 */
export function createGuard(
    guard: (args: { req: Request; res: Response; deny: Deny }) => Promise<ReturnType<Deny> | void> | ReturnType<Deny> | void
): RequestHandler {
    return async (req, res, next) => {
        const result = await guard({ req, res, deny });
        if (result && typeof result === 'object' && 'status' in result) {
            res.status(result.status).set('content-type', 'application/problem+json').json(problemDetails(result.status, result.detail));
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
    formatError?: ErrorFormatter<Request>;
}

const adapter = createAdapter<Request, void, ExpressHandlerContext, ExpressResponseContext>({
    buildHandlerContext: (adapterRequest, { res }) => ({
        req: adapterRequest.request,
        res,
    }),
    respond: (result, { res, next, formatError }) => {
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
        const rendered = renderJsonResult(result, formatError as ErrorFormatter, res.req);
        for (const [key, value] of Object.entries(rendered.headers)) {
            res.setHeader(key, value);
        }
        if (rendered.body === undefined) {
            res.status(rendered.status).end();
        } else if (rendered.raw) {
            const body = rendered.body;
            // Strings go out as-is; binary (Uint8Array/Buffer) is sent as bytes — never JSON-serialized.
            res.status(rendered.status).send(typeof body === 'string' || Buffer.isBuffer(body) ? body : Buffer.from(body as Uint8Array));
        } else {
            res.status(rendered.status).json(rendered.body);
        }
    },
});

/**
 * Mount a ts-kizuna API onto an Express app.
 *
 * @example
 * createExpressEndpoints(api, app);
 */
export function createExpressEndpoints(api: ExpressApi, app: AppLike, options?: ExpressOptions): ExpressRouter {
    const resolvedRouter = api[ROUTER_META] as CoreRouter<Routes, ExpressHandlerContext>;
    const middlewareMap = api[MIDDLEWARE_META] as MiddlewareMap<Routes, RequestHandler> | undefined;

    const expressRouter = createExpressRouter();
    for (const { routeKey, route } of adapter.eachRoute(api as unknown as Routes, resolvedRouter)) {
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
                    routes: api as unknown as Routes,
                    router: resolvedRouter,
                    request: adapterRequest,
                    responseContext: {
                        res,
                        next,
                        formatError: options?.formatError,
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
 * Bind a contract to its router and per-route middleware.
 *
 * @example
 * export const api = createApi({
 *     contract,
 *     router,
 *     middleware,
 * });
 */
export const createApi = <const R extends Routes>(options: {
    contract: Contract<R, Record<string, TagOptions>, string>;
    router: Router<Contract<R>>;
    middleware?: MiddlewareMap<R, RequestHandler>;
}): ExpressApi<R> => {
    const { contract, router, middleware } = options;
    const spec = coreApi(contract.routes);
    return Object.assign(spec, {
        [ROUTER_META]: router,
        [MIDDLEWARE_META]: middleware,
    }) as unknown as ExpressApi<R>;
};
