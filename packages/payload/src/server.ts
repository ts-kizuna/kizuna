import type { Config, Endpoint, PayloadRequest } from 'payload';
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
    createApi as coreCreateApi,
    resolveMiddleware,
    renderJsonResult,
    parseFetchBody,
    headersToObject,
} from '@ts-kizuna/core/adapter';

export type PayloadApi<R extends Contract = Contract> = R & ApiWithRouter & { readonly [MIDDLEWARE_META]?: unknown };

export interface PayloadHandlerContext {
    req: PayloadRequest;
}

export type RouteHandler<R extends RouteDefinition> = CoreRouteHandler<R, PayloadHandlerContext>;
export type Router<T extends Contract> = CoreRouter<T, PayloadHandlerContext>;

export interface PayloadMiddlewareRoute {
    path: string;
    method: string;
}

export type PayloadMiddlewareHandler = (req: PayloadRequest, route: PayloadMiddlewareRoute) => Response | void | Promise<Response | void>;

/**
 * Bind typed handler implementations to a contract.
 *
 * ```ts
 * import { createRouter } from '@ts-kizuna/payload';
 * import { contract } from './contract';
 *
 * export const router = createRouter(contract, {
 *     listUsers: ({ query, req }) => ({
 *         status: 200,
 *         body: { users: [], total: 0 },
 *     }),
 *     createUser: ({ body, req }) => ({
 *         status: 201,
 *         body: { id: '1', ...body },
 *     }),
 * });
 * ```
 */
export const createRouter = <T extends Contract>(_contract: T, router: Router<T>): Router<T> => router;

/**
 * Declare per-route middleware in the same shape as the contract.
 *
 * ```ts
 * import { createMiddleware } from '@ts-kizuna/payload';
 * import { contract } from './contract';
 *
 * export const middleware = createMiddleware(contract, {
 *     listUsers: [requireAuth],
 *     createUser: [requireAuth, requireAdmin],
 * });
 * ```
 */
export const createMiddleware = <T extends Contract>(
    _contract: T,
    map: MiddlewareMap<T, PayloadMiddlewareHandler>
): MiddlewareMap<T, PayloadMiddlewareHandler> => map;

type Deny = (status: number, message: string) => Response;

const deny: Deny = (status, message) =>
    Response.json(
        {
            message,
        },
        {
            status,
        }
    );

/**
 * Create a guard — a middleware that checks access before the handler runs.
 *
 * Call `deny(status, message)` to reject the request.
 * Return without calling `deny` to allow it through.
 *
 * ```ts
 * import { createGuard } from '@ts-kizuna/payload';
 *
 * const requireAuth = createGuard(async (req, deny) => {
 *     if (!req.user) {
 *         return deny(401, 'Unauthorized');
 *     }
 * });
 * ```
 */
export function createGuard(
    guard: (req: PayloadRequest, deny: Deny) => Promise<Response | void> | Response | void
): PayloadMiddlewareHandler {
    return async (req) => {
        const result = await guard(req, deny);
        if (result instanceof Response) {
            return result;
        }
    };
}

export interface PayloadOptions {
    /**
     * Prefix all endpoint paths.
     */
    basePath?: string;
    /**
     * Validate handler return values against the contract's response schemas.
     * Mismatches surface as 500 errors. Intended for development; disable in production.
     *
     * @default false
     */
    responseValidation?: boolean;
}

const payloadAdapter = createAdapter<PayloadRequest, Response, PayloadHandlerContext>({
    buildHandlerContext: (adapterRequest) => ({
        req: adapterRequest.request,
    }),
    respond: (result) => {
        if (result.kind === 'handler-error') {
            console.error('[ts-kizuna/payload] handler error:', result.error);
            return Response.json(
                {
                    message: 'Internal Server Error',
                },
                {
                    status: 500,
                }
            );
        }
        if (result.kind === 'raw-response') {
            return result.response as Response;
        }
        const rendered = renderJsonResult(result);
        if (rendered.body === undefined) {
            return new Response(null, {
                status: rendered.status,
                headers: rendered.headers,
            });
        }
        return Response.json(rendered.body, {
            status: rendered.status,
            headers: rendered.headers,
        });
    },
});

/**
 * Define a fully-typed Payload CMS API — routes, handlers, and middleware in one call.
 *
 * ```ts
 * import { createApi } from '@ts-kizuna/payload';
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
export function createApi<const R extends Contract>(options: {
    contract: R;
    router: Router<R>;
    middleware?: MiddlewareMap<R, PayloadMiddlewareHandler>;
}): PayloadApi<R> {
    const { contract, router, middleware } = options;
    const spec = coreCreateApi(contract);
    return Object.assign(spec, {
        [ROUTER_META]: router,
        [MIDDLEWARE_META]: middleware,
    }) as unknown as PayloadApi<R>;
}

/**
 * Create a Payload CMS plugin that mounts a ts-kizuna API as custom endpoints.
 *
 * ```ts
 * import { buildConfig } from 'payload';
 * import { kizunaPlugin } from '@ts-kizuna/payload';
 * import { api } from './api';
 *
 * export default buildConfig({
 *     plugins: [kizunaPlugin(api)],
 * });
 * ```
 */
export function kizunaPlugin(api: PayloadApi, options?: PayloadOptions): (incomingConfig: Config) => Config {
    return (incomingConfig: Config): Config => {
        const resolvedRouter = api[ROUTER_META] as Router<Contract>;
        const middlewareMap = api[MIDDLEWARE_META] as MiddlewareMap<Contract, PayloadMiddlewareHandler> | undefined;
        const endpoints: Endpoint[] = [];

        for (const { routeKey, route } of payloadAdapter.eachRoute(
            api as unknown as Contract,
            resolvedRouter as CoreRouter<Contract, PayloadHandlerContext>
        )) {
            const routeMiddleware = resolveMiddleware(routeKey, middlewareMap);
            const method = route.method.toLowerCase() as Endpoint['method'];

            const endpointPath = options?.basePath ? `${options.basePath}${route.path}` : route.path;

            endpoints.push({
                path: endpointPath,
                method,
                handler: async (req: PayloadRequest) => {
                    const middlewareRoute: PayloadMiddlewareRoute = {
                        path: route.path,
                        method: route.method,
                    };
                    for (const middleware of routeMiddleware) {
                        const result = await middleware(req, middlewareRoute);
                        if (result instanceof Response) {
                            return result;
                        }
                    }

                    const params: Record<string, string> = {};
                    if (req.routeParams) {
                        for (const [key, value] of Object.entries(req.routeParams)) {
                            params[key] = String(value);
                        }
                    }

                    const adapterRequest: AdapterRequest<PayloadRequest> = {
                        request: req,
                        method: req.method ?? route.method,
                        resolution: {
                            kind: 'pre-resolved',
                            routeKey,
                            route,
                            params,
                        },
                        query: req.query ?? {},
                        headers: headersToObject(req.headers),
                        readBody: (routeDefinition: RouteDefinition) => parseFetchBody(req as unknown as Request, routeDefinition),
                    };

                    return payloadAdapter.handle({
                        contract: api as unknown as Contract,
                        router: resolvedRouter as CoreRouter<Contract, PayloadHandlerContext>,
                        request: adapterRequest,
                        responseContext: {},
                        responseValidation: options?.responseValidation,
                    });
                },
            });
        }

        return {
            ...incomingConfig,
            endpoints: [...(incomingConfig.endpoints ?? []), ...endpoints],
        };
    };
}
