import type { Context, Env, Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
    type AdapterRequest,
    type RouteDefinition,
    type Contract,
    type RouteHandler as CoreRouteHandler,
    type Router as CoreRouter,
    type ApiWithRouter,
    ROUTER_META,
    createAdapter,
    createApi as coreCreateApi,
    renderJsonResult,
    parseFetchBody,
    headersToObject,
} from '@ts-kizuna/core/adapter';

export type HonoApi<R extends Contract = Contract> = R & ApiWithRouter;

export interface HonoHandlerContext<E extends Env = Env> {
    c: Context<E>;
}

export type RouteHandler<R extends RouteDefinition, E extends Env = Env> = CoreRouteHandler<R, HonoHandlerContext<E>>;
export type Router<T extends Contract, E extends Env = Env> = CoreRouter<T, HonoHandlerContext<E>>;

export interface HonoOptions {
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
 * import { createRouter } from '@ts-kizuna/hono';
 * import { contract } from './contract';
 *
 * export const router = createRouter(contract, {
 *     listUsers: ({ query }) => ({ status: 200, body: { users: [], total: 0 } }),
 *     createUser: ({ body }) => ({ status: 201, body: { id: '1', ...body } }),
 * });
 * ```
 */
export const createRouter = <T extends Contract, E extends Env = Env>(
    _contract: T,
    router: Router<T, E>,
): Router<T, E> => router;

const honoAdapter = createAdapter<Request, Response, HonoHandlerContext<Env>, { c: Context<Env> }>({
    buildHandlerContext: (_adapterRequest, { c }) => ({ c }),
    respond: (result, { c }) => {
        if (result.kind === 'handler-error') {
            throw result.error;
        }
        if (result.kind === 'raw-response') {
            return result.response as Response;
        }
        const rendered = renderJsonResult(result);
        if (rendered.body === undefined) {
            return c.body(null, rendered.status as ContentfulStatusCode, rendered.headers);
        }
        return c.json(rendered.body as object, rendered.status as ContentfulStatusCode, rendered.headers);
    },
});

/**
 * Define a fully-typed Hono API — routes and handlers in one call.
 *
 * ```ts
 * import { createApi } from '@ts-kizuna/hono';
 * import { contract } from './contract';
 * import { router } from './router';
 *
 * export const api = createApi({ contract, router });
 * ```
 */
export function createApi<const R extends Contract, E extends Env = Env>(options: {
    contract: R;
    router: Router<R, E>;
}): HonoApi<R> {
    const { contract, router } = options;
    const spec = coreCreateApi(contract);
    return Object.assign(spec, {
        [ROUTER_META]: router,
    }) as unknown as HonoApi<R>;
}

/**
 * Mount a ts-kizuna API onto a Hono app.
 *
 * ```ts
 * import { Hono } from 'hono';
 * import { createHonoEndpoints } from '@ts-kizuna/hono';
 * import { api } from './api';
 *
 * const app = new Hono();
 * createHonoEndpoints(api, app);
 * ```
 */
export function createHonoEndpoints<E extends Env>(
    api: HonoApi,
    app: Hono<E>,
    options?: HonoOptions,
): void {
    const resolvedRouter = api[ROUTER_META] as Router<Contract, E>;

    for (const { routeKey, route } of honoAdapter.eachRoute(
        api as unknown as Contract,
        resolvedRouter as CoreRouter<Contract, HonoHandlerContext<Env>>,
    )) {
        const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete' | 'options';

        app.on(method, route.path, async (c: Context<E>) => {
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
                contract: api as unknown as Contract,
                router: resolvedRouter as CoreRouter<Contract, HonoHandlerContext<Env>>,
                request: adapterRequest,
                responseContext: { c: c as unknown as Context<Env> },
                responseValidation: options?.responseValidation,
            });
        });
    }
}
