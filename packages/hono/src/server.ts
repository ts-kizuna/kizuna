import type { Context, Env, Hono, MiddlewareHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
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
    createApi as coreApi,
    resolveMiddleware,
    renderJsonResult,
    parseFetchBody,
    headersToObject,
    problemDetails,
} from '@ts-kizuna/core/adapter';
import type { Contract, TagOptions } from '@ts-kizuna/core';

export type HonoApi<R extends Routes = Routes> = R & ApiWithRouter & { readonly [MIDDLEWARE_META]?: unknown };

export interface HonoHandlerContext<E extends Env = Env> {
    c: Context<E>;
}

/**
 * The handler type for a single route, typed against its contract definition.
 */
export type RouteHandler<R extends RouteDefinition, E extends Env = Env> = CoreRouteHandler<R, HonoHandlerContext<E>>;

/**
 * The handler tree for a contract, typed against it. Preserves Hono's {@link Env}
 * generic for the handler context.
 */
export type Router<C, E extends Env = Env> =
    C extends Contract<infer R, infer _Tags, infer _Codes>
        ? CoreRouter<R, HonoHandlerContext<E>>
        : C extends Routes
          ? CoreRouter<C, HonoHandlerContext<E>>
          : never;

export interface HonoOptions {
    /**
     * Validate handler return values against the routes' response schemas.
     * Mismatches surface as 500 errors. Intended for development; disable in
     * production.
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
export const createRouter = <const R extends Routes, E extends Env = Env>(
    _contract: Contract<R, Record<string, TagOptions>, string>,
    router: Router<Contract<R>, E>
): Router<Contract<R>, E> => router;

/**
 * Declare per-route middleware in the same shape as the contract's routes.
 *
 * @example
 * export const middleware = createMiddleware(contract, {
 *     listUsers: [auth],
 *     createUser: [auth, adminOnly],
 * });
 */
export const createMiddleware = <const R extends Routes, E extends Env = Env>(
    _contract: Contract<R, Record<string, TagOptions>, string>,
    map: MiddlewareMap<R, MiddlewareHandler<E>>
): MiddlewareMap<R, MiddlewareHandler<E>> => map;

type Deny = (status: number, detail: string) => Response;

const deny: Deny = (status, detail) =>
    new Response(JSON.stringify(problemDetails(status, detail)), {
        status,
        headers: {
            'content-type': 'application/problem+json',
        },
    });

/**
 * Create a guard — a middleware that checks access before the handler runs. Call
 * `deny(status, detail)` to reject the request; return without calling it to allow.
 *
 * @example
 * const requireAdmin = createGuard<AuthEnv>(async ({ c, deny }) => {
 *     if (c.get('user').role !== 'admin') return deny(403, 'Forbidden');
 * });
 */
export function createGuard<E extends Env = Env>(
    guard: (args: { c: Context<E>; deny: Deny }) => Promise<Response | void> | Response | void
): MiddlewareHandler<E> {
    return async (context, next) => {
        const result = await guard({ c: context, deny });
        if (result instanceof Response) {
            return result;
        }
        await next();
    };
}

const honoAdapter = createAdapter<Request, Response, HonoHandlerContext<Env>, { c: Context<Env>; formatError?: ErrorFormatter<Request> }>({
    buildHandlerContext: (_adapterRequest, { c }) => ({ c }),
    respond: (result, { c, formatError }) => {
        if (result.kind === 'handler-error') {
            throw result.error;
        }
        if (result.kind === 'raw-response') {
            return result.response as Response;
        }
        const rendered = renderJsonResult(result, formatError as ErrorFormatter, c.req.raw);
        if (rendered.body === undefined) {
            return c.body(null, rendered.status as ContentfulStatusCode, rendered.headers);
        }
        if (rendered.raw) {
            // Strings and binary (Uint8Array/ArrayBuffer) bodies are sent as-is, never JSON-serialized.
            return c.body(rendered.body as ArrayBuffer | string, rendered.status as ContentfulStatusCode, rendered.headers);
        }
        return c.json(rendered.body as object, rendered.status as ContentfulStatusCode, rendered.headers);
    },
});

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
export function createApi<const R extends Routes, E extends Env = Env>(options: {
    contract: Contract<R, Record<string, TagOptions>, string>;
    router: Router<Contract<R>, E>;
    middleware?: MiddlewareMap<R, MiddlewareHandler<E>>;
}): HonoApi<R> {
    const { contract, router, middleware } = options;
    const spec = coreApi(contract.routes);
    return Object.assign(spec, {
        [ROUTER_META]: router,
        [MIDDLEWARE_META]: middleware,
    }) as unknown as HonoApi<R>;
}

/**
 * Mount a ts-kizuna API onto a Hono app.
 *
 * @example
 * const app = new Hono();
 * createHonoEndpoints(api, app);
 */
export function createHonoEndpoints<E extends Env = Env>(api: HonoApi, app: Hono<E>, options?: HonoOptions): void {
    const resolvedRouter = api[ROUTER_META] as CoreRouter<Routes, HonoHandlerContext<E>>;
    const middlewareMap = api[MIDDLEWARE_META] as MiddlewareMap<Routes, MiddlewareHandler<E>> | undefined;

    for (const { routeKey, route } of honoAdapter.eachRoute(
        api as unknown as Routes,
        resolvedRouter as CoreRouter<Routes, HonoHandlerContext<Env>>
    )) {
        const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete' | 'options';
        const routeMiddleware = resolveMiddleware(routeKey, middlewareMap);
        const kizunaHandler = async (c: Context<E>) => {
            const url = new URL(c.req.url);

            const adapterRequest: AdapterRequest<Request> = {
                request: c.req.raw,
                method: c.req.method,
                resolution: {
                    kind: 'pre-resolved',
                    routeKey,
                    route,
                    params: c.req.param() as Record<string, string>,
                },
                query: Object.fromEntries(url.searchParams),
                headers: headersToObject(c.req.raw.headers),
                readBody: (r: RouteDefinition) => parseFetchBody(c.req.raw, r),
            };

            return honoAdapter.handle({
                routes: api as unknown as Routes,
                router: resolvedRouter as CoreRouter<Routes, HonoHandlerContext<Env>>,
                request: adapterRequest,
                responseContext: {
                    c: c as unknown as Context<Env>,
                    formatError: options?.formatError,
                },
                responseValidation: options?.responseValidation,
            });
        };
        (app.on as (method: string, path: string, ...handlers: MiddlewareHandler[]) => void)(
            method,
            route.path,
            ...(routeMiddleware as MiddlewareHandler[]),
            kizunaHandler as MiddlewareHandler
        );
    }
}
