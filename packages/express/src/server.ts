import type { Request, Response, NextFunction, RequestHandler, Router as ExpressRouter } from 'express';
import { Router as createExpressRouter } from 'express';
import type { z } from 'zod';
import {
    type AdapterRequest,
    type RouteDefinition,
    type Routes,
    type MiddlewareMap,
    type RouteHandler as CoreRouteHandler,
    type Router as CoreRouter,
    type ApiWithRouter,
    type ErrorFormatter,
    type GuardDenial,
    type GuardErrorBody,
    type ErrorMode,
    ROUTER_META,
    MIDDLEWARE_META,
    createAdapter,
    resolveMiddleware,
    renderJsonResult,
    renderGuardDenial,
    guardDenial,
    isGuardDenial,
    usesProblemDetails,
    createApi as coreApi,
} from '@ts-kizuna/core/adapter';
import type { Contract, TagOptions } from '@ts-kizuna/core';

/**
 * A contract with its routes `R`, error `Mode`, and guard-error schema captured for
 * inference; tags and issue codes are widened (they don't affect handler/guard typing).
 */
type ContractOf<R extends Routes, Mode extends ErrorMode> = Contract<R, Record<string, TagOptions>, string, Mode, z.ZodType | undefined>;

/**
 * The routes type carried by a contract `C`.
 */
type ContractRoutes<C> = C extends Contract<infer R, infer _Tags, infer _Codes, infer _Mode, infer _GuardError> ? R : never;

/**
 * The `deny(status, body)` body type for a guard bound to contract `C`, from its
 * `guardErrorSchema` and error mode. See {@link GuardErrorBody}.
 */
type DenyBody<C> =
    C extends Contract<infer _R, infer _Tags, infer _Codes, infer Mode, infer GuardError> ? GuardErrorBody<GuardError, Mode> : unknown;

/**
 * Constraint that accepts any contract regardless of error mode or guard schema. The bare
 * `Contract` default (Problem Details, no guard schema) would reject opted-out contracts.
 */
type AnyContract = Contract<Routes, Record<string, TagOptions>, string, ErrorMode, z.ZodType | undefined>;

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
 * The handler tree for a contract, typed against it.
 */
export type Router<C> =
    C extends Contract<infer R, infer _Tags, infer _Codes, infer Mode, infer _GuardError>
        ? CoreRouter<R, ExpressHandlerContext, Mode>
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
 * Declare per-route middleware in the same shape as the contract's routes.
 *
 * @example
 * export const middleware = createMiddleware(contract, {
 *     listUsers: [authenticate],
 *     createUser: [authenticate, adminOnly],
 * });
 */
export const createMiddleware = <const C extends AnyContract>(
    _contract: C,
    map: MiddlewareMap<ContractRoutes<C>, RequestHandler>
): MiddlewareMap<ContractRoutes<C>, RequestHandler> => map;

/**
 * Rejects a request from inside a guard. `deny(status, detail)` is shorthand for a
 * Problem Details body; `deny(status, body)` sends a custom body (typed from the
 * contract's `guardErrorSchema`).
 */
interface Deny<Body = unknown> {
    (status: number, detail: string): GuardDenial;
    (status: number, body: Body): GuardDenial;
}

type GuardFn<Body> = (args: { req: Request; res: Response; deny: Deny<Body> }) => Promise<GuardDenial | void> | GuardDenial | void;

/**
 * Create a guard — a middleware that checks access before the handler runs. Call
 * `deny(...)` to reject the request; return without calling it to allow.
 *
 * Pass the contract first (`createGuard(contract, fn)`) to type `deny`'s body against the
 * contract's `guardErrorSchema` and render denials in the contract's error mode.
 *
 * @example
 * const requireAdmin = createGuard(contract, async ({ req, deny }) => {
 *     if (req.user?.role !== 'admin') return deny(403, 'Forbidden');
 * });
 */
export function createGuard(guard: GuardFn<unknown>): RequestHandler;
export function createGuard<const C extends AnyContract>(contract: C, guard: GuardFn<DenyBody<C>>): RequestHandler;
export function createGuard(contractOrGuard: Contract | GuardFn<unknown>, maybeGuard?: GuardFn<unknown>): RequestHandler {
    const contract = typeof contractOrGuard === 'function' ? undefined : contractOrGuard;
    const guard = (typeof contractOrGuard === 'function' ? contractOrGuard : maybeGuard) as GuardFn<unknown>;
    const useProblemDetails = contract ? usesProblemDetails(contract.routes) : true;
    const deny = ((status: number, bodyOrDetail: unknown) => guardDenial(status, bodyOrDetail)) as Deny<unknown>;
    return async (req, res, next) => {
        const result = await guard({ req, res, deny });
        if (isGuardDenial(result)) {
            const rendered = renderGuardDenial(result, useProblemDetails);
            for (const [key, value] of Object.entries(rendered.headers)) {
                res.setHeader(key, value);
            }
            if (rendered.raw) {
                const body = rendered.body;
                // Strings go out as-is; binary is sent as bytes — never JSON-serialized.
                res.status(rendered.status).send(
                    typeof body === 'string' || Buffer.isBuffer(body) ? body : Buffer.from(body as Uint8Array)
                );
            } else {
                res.status(rendered.status).json(rendered.body);
            }
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
export function createApi<const R extends Routes>(options: {
    contract: ContractOf<R, 'problem-details'>;
    router: Router<ContractOf<R, 'problem-details'>>;
    middleware?: MiddlewareMap<R, RequestHandler>;
}): ExpressApi<R>;
export function createApi<const R extends Routes>(options: {
    contract: ContractOf<R, 'custom'>;
    router: Router<ContractOf<R, 'custom'>>;
    middleware?: MiddlewareMap<R, RequestHandler>;
}): ExpressApi<R>;
export function createApi(options: any): ExpressApi {
    const { contract, router, middleware } = options;
    const spec = coreApi(contract.routes);
    return Object.assign(spec, {
        [ROUTER_META]: router,
        [MIDDLEWARE_META]: middleware,
    }) as unknown as ExpressApi;
}
