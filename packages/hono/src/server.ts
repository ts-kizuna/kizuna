import type { Context, Env, Hono, MiddlewareHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
    type AdapterRequest,
    type RouteDefinition,
    type Routes,
    type RouteHandler as CoreRouteHandler,
    type Router as CoreRouter,
    type ApiWithRouter,
    type ErrorFormatter,
    type GuardMap,
    type RequestContextMap,
    ROUTER_META,
    GUARDS_META,
    SCHEMES_META,
    REQUEST_CONTEXT_META,
    JOBS_META,
    RECEIVERS_META,
    type ServerOptions,
    type JobsMeta,
    pluginRoutesOf,
    pluginExportsOf,
    pluginRouterOf,
    createAdapter,
    jobRoutes,
    receiverRoutes,
    receiverRouter,
    type ReceiversMeta,
    jobRouter,
    jobRunnerFrom,
    createServerSurface,
    type Server as CoreServer,
    type ContractRouter,
    type ContractJobsRouter,
    renderJsonResult,
    parseFetchBody,
    headersToObject,
} from '@ts-kizuna/core/adapter';
import type { Contract, RoutesOf, SecurityScheme, GuardSuccess } from '@ts-kizuna/core';
import type { HandlersFromAuth, GuardParams, RequestContextValues } from '@ts-kizuna/core/adapter';

export type HonoApi<R extends Routes = Routes> = ApiWithRouter<R> & {
    readonly [GUARDS_META]?: unknown;
    readonly [SCHEMES_META]?: unknown;
    readonly [REQUEST_CONTEXT_META]?: unknown;
    readonly [JOBS_META]?: unknown;
    readonly [RECEIVERS_META]?: unknown;
    /**
     * Register every contract route on a Hono app.
     */
    mount: <E extends Env = Env>(app: Hono<E>, options?: HonoOptions) => void;
};

export interface HonoHandlerContext<E extends Env = Env> {
    c: Context<E>;
}

/**
 * The handler type for a single route, typed against its contract definition.
 */
export type RouteHandler<R extends RouteDefinition, E extends Env = Env> = CoreRouteHandler<R, HonoHandlerContext<E>>;

/**
 * The handler tree for a contract or route group, typed against it. Preserves
 * Hono's {@link Env} generic for the handler context. Routes secured by the
 * contract's `auth` map additionally receive each required identity's context
 * in their handler args, under `auth`, keyed by the identity's name.
 */
export type Router<C, E extends Env = Env> = ContractRouter<C, HonoHandlerContext<E>>;

/**
 * The handler for each of a contract's scheduled jobs, typed against it. Each
 * receives only the job's `input`, so the same handler can be run in process.
 */
export type JobsRouter<C> = ContractJobsRouter<C>;

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
 * A guard per identity, keyed by name. Each receives the handler context, a
 * `deny` helper, and the matched route's required scopes, and returns that
 * identity's {@link GuardSuccess} (its context and access fields) or a `deny(...)`
 * result. Keying by name lets each guard's return be typed against its own
 * identity, so access values narrow without an annotation. An
 * authentication-only identity (no context, no access) returns nothing on
 * success, or `deny(...)`.
 */

/**
 * One guard per identity declared on the contract.
 */

/**
 * The resolver functions for the request context schemas declared on `kizuna`,
 * keyed by name. Each runs on every route and returns its schema's value.
 */

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
 * Mount a ts-kizuna API onto a Hono app.
 *
 * @example
 * const app = new Hono();
 * api.mount(app);
 */
export function mountHono<E extends Env = Env>(api: HonoApi, app: Hono<E>, options?: HonoOptions): void {
    const guards = api[GUARDS_META] as GuardMap<HonoHandlerContext<Env>> | undefined;
    const schemes = api[SCHEMES_META] as Record<string, SecurityScheme> | undefined;
    const requestContext = api[REQUEST_CONTEXT_META] as RequestContextMap<HonoHandlerContext<Env>> | undefined;

    const pluginExports = pluginExportsOf(api);
    const jobsMeta = api[JOBS_META] as JobsMeta | undefined;
    const jobRunner = jobRunnerFrom(jobsMeta);
    const receiversMeta = api[RECEIVERS_META] as ReceiversMeta | undefined;

    const mountRoute = (
        routeKey: string,
        route: RouteDefinition,
        lane: Routes,
        resolvedRouter: CoreRouter<Routes, HonoHandlerContext<Env>>
    ): void => {
        const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete' | 'options';
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
                    path: url.pathname,
                },
                query: Object.fromEntries(url.searchParams),
                headers: headersToObject(c.req.raw.headers),
                readBody: (r: RouteDefinition) => parseFetchBody(c.req.raw, r),
            };

            return honoAdapter.handle({
                routes: lane,
                router: resolvedRouter,
                request: adapterRequest,
                responseContext: {
                    c: c as unknown as Context<Env>,
                    formatError: options?.formatError,
                },
                guards,
                schemes,
                requestContext,
                pluginExports,
                jobs: jobRunner,
                responseValidation: options?.responseValidation,
            });
        };
        (app.on as (method: string, path: string, ...handlers: MiddlewareHandler[]) => void)(
            method,
            route.path,
            kizunaHandler as MiddlewareHandler
        );
    };

    const mountLane = (lane: Routes, resolvedRouter: CoreRouter<Routes, HonoHandlerContext<Env>>): void => {
        for (const { routeKey, route } of honoAdapter.eachRoute(lane, resolvedRouter)) {
            mountRoute(routeKey, route, lane, resolvedRouter);
        }
    };

    mountLane(api.routes, api[ROUTER_META] as CoreRouter<Routes, HonoHandlerContext<Env>>);
    mountLane(pluginRoutesOf(api), pluginRouterOf(api) as CoreRouter<Routes, HonoHandlerContext<Env>>);

    if (jobsMeta) {
        const routes = jobRoutes(jobsMeta);
        const router = jobRouter<HonoHandlerContext<Env>>(jobsMeta);
        for (const [routeKey, route] of Object.entries(routes)) {
            mountRoute(routeKey, route as RouteDefinition, routes, router);
        }
    }

    if (receiversMeta) {
        const routes = receiverRoutes(receiversMeta);
        const router = receiverRouter<HonoHandlerContext<Env>>(receiversMeta);
        for (const [routeKey, route] of Object.entries(routes)) {
            mountRoute(routeKey, route as RouteDefinition, routes, router);
        }
    }
}

export interface Server<C extends Contract, E extends Env = Env> extends CoreServer<C, HonoHandlerContext<E>, HonoApi<RoutesOf<C>>> {}

/**
 * Turn a contract into a server handle: the serving counterpart to `Kizuna`.
 * Keep the instance and use `server.guard` to define guards, `server.router`
 * to write typed handlers, and `server.api` to assemble them.
 */
export class KizunaServer<C extends Contract, E extends Env = Env> implements Server<C, E> {
    declare readonly guard: Server<C, E>['guard'];
    declare readonly requestContext: Server<C, E>['requestContext'];
    declare readonly router: Server<C, E>['router'];
    declare readonly jobs: Server<C, E>['jobs'];
    declare readonly receiver: Server<C, E>['receiver'];
    declare readonly api: Server<C, E>['api'];

    constructor(contract: C, options?: ServerOptions) {
        Object.assign(
            this,
            createServerSurface<C, HonoHandlerContext<E>, HonoApi<RoutesOf<C>>>(contract, options, (assembled) => {
                const api = assembled as HonoApi<RoutesOf<C>>;
                return Object.assign(api, {
                    mount: <Env_ extends Env = Env>(app: Hono<Env_>, mountOptions?: HonoOptions) => mountHono(api, app, mountOptions),
                });
            })
        );
    }
}
