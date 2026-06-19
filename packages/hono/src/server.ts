import type { Context, Env, Hono, MiddlewareHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
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
    createApi as coreApi,
    resolveMiddleware,
    renderJsonResult,
    renderGuardDenial,
    guardDenial,
    isGuardDenial,
    usesProblemDetails,
    parseFetchBody,
    headersToObject,
} from '@ts-kizuna/core/adapter';
import type { Contract, TagOptions } from '@ts-kizuna/core';

/**
 * The routes type carried by a contract `C`.
 */
type ContractRoutes<C> = C extends Contract<infer R, infer _Tags, infer _Codes, infer _Mode, infer _GuardError> ? R : never;

/**
 * A contract with its routes `R`, error `Mode`, and guard-error schema captured for
 * inference; tags and issue codes are widened (they don't affect handler/guard typing).
 */
type ContractOf<R extends Routes, Mode extends ErrorMode> = Contract<R, Record<string, TagOptions>, string, Mode, z.ZodType | undefined>;

/**
 * Constraint that accepts any contract regardless of error mode or guard schema. The bare
 * `Contract` default (Problem Details, no guard schema) would reject opted-out contracts.
 */
type AnyContract = Contract<Routes, Record<string, TagOptions>, string, ErrorMode, z.ZodType | undefined>;

/**
 * The `deny(status, body)` body type for a guard bound to contract `C`, from its
 * `guardErrorSchema` and error mode. See {@link GuardErrorBody}.
 */
type DenyBody<C> =
    C extends Contract<infer _R, infer _Tags, infer _Codes, infer Mode, infer GuardError> ? GuardErrorBody<GuardError, Mode> : unknown;

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
    C extends Contract<infer R, infer _Tags, infer _Codes, infer Mode, infer _GuardError>
        ? CoreRouter<R, HonoHandlerContext<E>, Mode>
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
export const createRouter = <const C extends AnyContract, E extends Env = Env>(_contract: C, router: Router<C, E>): Router<C, E> => router;

/**
 * Declare per-route middleware in the same shape as the contract's routes.
 *
 * @example
 * export const middleware = createMiddleware(contract, {
 *     listUsers: [auth],
 *     createUser: [auth, adminOnly],
 * });
 */
export const createMiddleware = <const C extends AnyContract, E extends Env = Env>(
    _contract: C,
    map: MiddlewareMap<ContractRoutes<C>, MiddlewareHandler<E>>
): MiddlewareMap<ContractRoutes<C>, MiddlewareHandler<E>> => map;

/**
 * Rejects a request from inside a guard. `deny(status, detail)` is shorthand for a
 * Problem Details body; `deny(status, body)` sends a custom body (typed from the
 * contract's `guardErrorSchema`).
 */
interface Deny<Body = unknown> {
    (status: number, detail: string): GuardDenial;
    (status: number, body: Body): GuardDenial;
}

type GuardFn<E extends Env, Body> = (args: {
    c: Context<E>;
    deny: Deny<Body>;
}) => Promise<GuardDenial | Response | void> | GuardDenial | Response | void;

/**
 * Create a guard — a middleware that checks access before the handler runs. Call
 * `deny(...)` to reject the request; return without calling it to allow.
 *
 * Pass the contract first (`createGuard(contract, fn)`) to type `deny`'s body against the
 * contract's `guardErrorSchema` and render denials in the contract's error mode.
 *
 * @example
 * const requireAdmin = createGuard(contract, async ({ c, deny }) => {
 *     if (c.get('user').role !== 'admin') return deny(403, 'Forbidden');
 * });
 */
export function createGuard<E extends Env = Env>(guard: GuardFn<E, unknown>): MiddlewareHandler<E>;
export function createGuard<const C extends AnyContract, E extends Env = Env>(
    contract: C,
    guard: GuardFn<E, DenyBody<C>>
): MiddlewareHandler<E>;
export function createGuard<E extends Env = Env>(
    contractOrGuard: Contract | GuardFn<E, unknown>,
    maybeGuard?: GuardFn<E, unknown>
): MiddlewareHandler<E> {
    const contract = typeof contractOrGuard === 'function' ? undefined : contractOrGuard;
    const guard = (typeof contractOrGuard === 'function' ? contractOrGuard : maybeGuard) as GuardFn<E, unknown>;
    const useProblemDetails = contract ? usesProblemDetails(contract.routes) : true;
    const deny = ((status: number, bodyOrDetail: unknown) => guardDenial(status, bodyOrDetail)) as Deny<unknown>;
    return async (context, next) => {
        const result = await guard({ c: context, deny });
        if (isGuardDenial(result)) {
            const rendered = renderGuardDenial(result, useProblemDetails);
            const body = rendered.raw ? (rendered.body as BodyInit) : JSON.stringify(rendered.body);
            return new Response(body, {
                status: rendered.status,
                headers: rendered.headers,
            });
        }
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
    contract: ContractOf<R, 'problem-details'>;
    router: Router<ContractOf<R, 'problem-details'>, E>;
    middleware?: MiddlewareMap<R, MiddlewareHandler<E>>;
}): HonoApi<R>;
export function createApi<const R extends Routes, E extends Env = Env>(options: {
    contract: ContractOf<R, 'custom'>;
    router: Router<ContractOf<R, 'custom'>, E>;
    middleware?: MiddlewareMap<R, MiddlewareHandler<E>>;
}): HonoApi<R>;
export function createApi(options: any): HonoApi {
    const { contract, router, middleware } = options;
    const spec = coreApi(contract.routes);
    return Object.assign(spec, {
        [ROUTER_META]: router,
        [MIDDLEWARE_META]: middleware,
    }) as unknown as HonoApi;
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
