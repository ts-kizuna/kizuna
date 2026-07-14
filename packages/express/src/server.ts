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
    type GuardMap,
    type GuardRun,
    type GuardDeny,
    type GuardDenial,
    type RequestContextMap,
    type RequestContextRun,
    ROUTER_META,
    GUARDS_META,
    SCHEMES_META,
    REQUEST_CONTEXT_META,
    MIDDLEWARE_META,
    createAdapter,
    resolveMiddleware,
    renderJsonResult,
    createApi as coreApi,
} from '@ts-kizuna/core/adapter';
import type { z } from 'zod';
import type {
    Contract,
    TagOptions,
    SecurityScheme,
    HandlersFromAuth,
    GuardSuccess,
    CredentialOf,
    HeadersOf,
    GuardParams,
    RequestContextSchema,
    RequestContextHeaderValues,
    RequestContextValues,
} from '@ts-kizuna/core';

export type ExpressApi<R extends Routes = Routes> = R &
    ApiWithRouter & {
        readonly [GUARDS_META]?: unknown;
        readonly [SCHEMES_META]?: unknown;
        readonly [REQUEST_CONTEXT_META]?: unknown;
        readonly [MIDDLEWARE_META]?: unknown;
    };

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
 * The handler tree for a contract or route group, typed against it. Routes
 * secured by the contract's `auth` map additionally receive each required
 * identity's context in their handler args, under `auth`, keyed by the identity's name.
 */
export type Router<C> =
    C extends Contract<infer R, infer _Tags, infer _Codes, infer Schemes, infer Auth, infer RequestContext>
        ? HandlersFromAuth<R, ExpressHandlerContext & RequestContextValues<RequestContext>, Schemes, Auth>
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
 * Bind typed handler implementations to a contract, one of its route groups
 * (pass the group key as the second argument), or a bare route group.
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
 * Declare per-route middleware in the same shape as the contract's or group's routes.
 *
 * @deprecated Define auth with identities + the contract's `auth` map and pass
 * `guards` to `createApi`. See /docs/auth.
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

/**
 * A guard per identity, keyed by name. Each receives the handler context, a
 * `deny` helper, and the matched route's required scopes, and returns that
 * identity's {@link GuardSuccess} (its context and access fields) or a `deny(...)`
 * result. Keying by name lets each guard's return be typed against its own
 * identity, so access values narrow without an annotation. An
 * authentication-only identity (no context, no access) returns nothing on
 * success, or `deny(...)`.
 */
type GuardFns<Schemes extends Record<string, SecurityScheme>, Params> = {
    [Name in keyof Schemes]: (
        args: ExpressHandlerContext &
            CredentialOf<Schemes[Name]> & {
                params: Params;
                headers: HeadersOf<Schemes[Name]>;
                deny: GuardDeny;
                scopes: string[];
            }
    ) => [keyof GuardSuccess<Schemes[Name]>] extends [never]
        ? void | GuardDenial | Promise<void | GuardDenial>
        : GuardSuccess<Schemes[Name]> | GuardDenial | Promise<GuardSuccess<Schemes[Name]> | GuardDenial>;
};

/**
 * One guard per identity declared on the contract.
 */
type GuardsForSchemes<Schemes extends Record<string, SecurityScheme>> = {
    [Name in keyof Schemes]: GuardRun<ExpressHandlerContext>;
};

/**
 * The resolver functions for the request context schemas declared on `kizuna`,
 * keyed by name. Each runs on every route and returns its schema's value.
 */
type RequestResolverFns<RequestContext extends Record<string, RequestContextSchema>> = {
    [Name in keyof RequestContext]: (
        args: ExpressHandlerContext & {
            params: Record<string, string>;
            headers: RequestContextHeaderValues<RequestContext[Name]>;
        }
    ) => z.output<RequestContext[Name]['context']> | Promise<z.output<RequestContext[Name]['context']>>;
};

/**
 * Implement a request context provider declared on `kizuna` under `context`. It
 * runs on every route — public ones included — and never denies; handlers read
 * its value under the provider's name.
 *
 * @example
 * export const captureAnalytics = createRequestContextResolver(contract, 'analytics', ({ req }) => ({
 *     sessionId: req.get('x-posthog-session-id') ?? null,
 * }));
 */
export function createRequestContextResolver<
    RequestContext extends Record<string, RequestContextSchema>,
    const Name extends Extract<keyof RequestContext, string>,
>(
    _contract: Contract<Routes, Record<string, TagOptions>, string, Record<string, SecurityScheme>, unknown, RequestContext>,
    _name: Name,
    run: RequestResolverFns<RequestContext>[Name]
): RequestContextRun<ExpressHandlerContext> {
    return run as unknown as RequestContextRun<ExpressHandlerContext>;
}

/**
 * Define a guard for an identity. It runs before the handlers of routes whose
 * `auth` entry requires the identity. The argument carries the request context
 * plus the credential the identity's method extracted (`bearer`, `apiKey`, or
 * `basic` — `null` when absent), a `deny` helper, and the route's `scopes`.
 * Return the identity's context and access fields to allow the request (read in
 * handlers under `auth`, keyed by the identity's name), or call `deny(status, detail)`.
 *
 * @example
 * export const requireUser = createGuard(contract, 'user', async ({ bearer, deny }) => {
 *     const session = bearer && (await verify(bearer.token));
 *     if (!session) return deny(401, 'Unauthorized');
 *     return {
 *         userId: session.userId,
 *     };
 * });
 */
export function createGuard<
    const R extends Routes,
    Schemes extends Record<string, SecurityScheme>,
    Auth,
    const Name extends Extract<keyof Schemes, string>,
>(
    _contract: Contract<R, Record<string, TagOptions>, string, Schemes, Auth>,
    _identity: Name,
    run: GuardFns<Schemes, GuardParams<R, Auth, Name>>[Name]
): GuardRun<ExpressHandlerContext> {
    return run as unknown as GuardRun<ExpressHandlerContext>;
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
    const guards = api[GUARDS_META] as GuardMap<ExpressHandlerContext> | undefined;
    const schemes = api[SCHEMES_META] as Record<string, SecurityScheme> | undefined;
    const requestContext = api[REQUEST_CONTEXT_META] as RequestContextMap<ExpressHandlerContext> | undefined;
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
                    guards,
                    schemes,
                    requestContext,
                    responseValidation: options?.responseValidation,
                });
            }
        );
    }
    app.use(expressRouter);

    return expressRouter;
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
        middleware?: MiddlewareMap<R, RequestHandler>;
    } & (string extends keyof RequestContext
        ? { requestContext?: undefined }
        : { requestContext: NoInfer<{ [Name in keyof RequestContext]: RequestContextRun<ExpressHandlerContext> }> })
): ExpressApi<R> => {
    const { contract, router, guards, requestContext, middleware } = options;
    const spec = coreApi(contract.routes);
    return Object.assign(spec, {
        [ROUTER_META]: router,
        [GUARDS_META]: guards,
        [SCHEMES_META]: contract.securitySchemes,
        [REQUEST_CONTEXT_META]: requestContext,
        [MIDDLEWARE_META]: middleware,
    }) as unknown as ExpressApi<R>;
};
