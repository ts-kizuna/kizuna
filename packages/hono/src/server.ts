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
    type GuardRun,
    type GuardDeny,
    type GuardDenial,
    type RequestContextMap,
    type RequestContextRun,
    type ApiParts,
    ROUTER_META,
    GUARDS_META,
    SCHEMES_META,
    REQUEST_CONTEXT_META,
    assembleApi,
    createAdapter,
    renderJsonResult,
    parseFetchBody,
    headersToObject,
} from '@ts-kizuna/core/adapter';
import type { z } from 'zod';
import type {
    Contract,
    TagOptions,
    SecurityScheme,
    GuardSuccess,
    CredentialOf,
    RequestContextSchema,
    RequestContextHeaderValues,
} from '@ts-kizuna/core';
import type { HandlersFromAuth, GuardParams, RequestContextValues } from '@ts-kizuna/core/adapter';

export type HonoApi<R extends Routes = Routes> = ApiWithRouter<R> & {
    readonly [GUARDS_META]?: unknown;
    readonly [SCHEMES_META]?: unknown;
    readonly [REQUEST_CONTEXT_META]?: unknown;
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
export type Router<C, E extends Env = Env> =
    C extends Contract<infer R, infer _Tags, infer _Codes, infer Schemes, infer Auth, infer RequestContext>
        ? HandlersFromAuth<R, HonoHandlerContext<E> & RequestContextValues<RequestContext>, Schemes, Auth>
        : C extends Routes
          ? CoreRouter<C, HonoHandlerContext<E>>
          : never;

/**
 * The handlers for a group named on the contract, or for a bare route group.
 * Both forms resolve through one signature: a second candidate of the same
 * arity costs zero-argument handlers their contextual type.
 */
type GroupRouter<Source, GroupOrRoutes, E extends Env> = GroupOrRoutes extends string
    ? Router<Source, E>[Extract<GroupOrRoutes, keyof Router<Source, E>>]
    : Router<GroupOrRoutes, E>;

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
type GuardFns<Schemes extends Record<string, SecurityScheme>, Params, E extends Env> = {
    [Name in keyof Schemes]: (
        args: HonoHandlerContext<E> &
            CredentialOf<Schemes[Name]> & {
                params: Params;
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
type GuardsForSchemes<Schemes extends Record<string, SecurityScheme>, E extends Env> = {
    [Name in keyof Schemes]: GuardRun<HonoHandlerContext<E>>;
};

/**
 * The resolver functions for the request context schemas declared on `kizuna`,
 * keyed by name. Each runs on every route and returns its schema's value.
 */
type RequestResolverFns<RequestContext extends Record<string, RequestContextSchema>, E extends Env> = {
    [Name in keyof RequestContext]: (
        args: HonoHandlerContext<E> & {
            params: Record<string, string>;
            headers: RequestContextHeaderValues<RequestContext[Name]>;
        }
    ) => z.output<RequestContext[Name]['context']> | Promise<z.output<RequestContext[Name]['context']>>;
};

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
function mountHono<E extends Env = Env>(api: HonoApi, app: Hono<E>, options?: HonoOptions): void {
    const resolvedRouter = api[ROUTER_META] as CoreRouter<Routes, HonoHandlerContext<E>>;
    const guards = api[GUARDS_META] as GuardMap<HonoHandlerContext<Env>> | undefined;
    const schemes = api[SCHEMES_META] as Record<string, SecurityScheme> | undefined;
    const requestContext = api[REQUEST_CONTEXT_META] as RequestContextMap<HonoHandlerContext<Env>> | undefined;

    for (const { routeKey, route } of honoAdapter.eachRoute(api.routes, resolvedRouter as CoreRouter<Routes, HonoHandlerContext<Env>>)) {
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
                },
                query: Object.fromEntries(url.searchParams),
                headers: headersToObject(c.req.raw.headers),
                readBody: (r: RouteDefinition) => parseFetchBody(c.req.raw, r),
            };

            return honoAdapter.handle({
                routes: api.routes,
                router: resolvedRouter as CoreRouter<Routes, HonoHandlerContext<Env>>,
                request: adapterRequest,
                responseContext: {
                    c: c as unknown as Context<Env>,
                    formatError: options?.formatError,
                },
                guards,
                schemes,
                requestContext,
                responseValidation: options?.responseValidation,
            });
        };
        (app.on as (method: string, path: string, ...handlers: MiddlewareHandler[]) => void)(
            method,
            route.path,
            kizunaHandler as MiddlewareHandler
        );
    }
}

type ServerContract<
    R extends Routes,
    Schemes extends Record<string, SecurityScheme>,
    Auth,
    RequestContext extends Record<string, RequestContextSchema>,
> = Contract<R, Record<string, TagOptions>, string, Schemes, Auth, RequestContext>;

export interface Server<
    R extends Routes,
    Schemes extends Record<string, SecurityScheme>,
    Auth,
    RequestContext extends Record<string, RequestContextSchema>,
    E extends Env = Env,
> {
    /**
     * Define a guard for one of the contract's identities. It runs before the
     * handlers of every route whose `auth` entry requires the identity, and
     * receives the credential its method extracted (`bearer`, `apiKey`, or
     * `basic` — `null` when absent). Return the identity's context and access
     * fields to allow the request, or call `deny(status, detail)`.
     */
    guard<const Name extends Extract<keyof Schemes, string>>(
        name: Name,
        run: GuardFns<Schemes, GuardParams<R, Auth, Name>, E>[Name]
    ): GuardRun<HonoHandlerContext<E>>;
    /**
     * Define a request context resolver declared on the contract. It runs on
     * every route — public ones included — and never denies.
     */
    requestContext<const Name extends Extract<keyof RequestContext, string>>(
        name: Name,
        run: RequestResolverFns<RequestContext, E>[Name]
    ): RequestContextRun<HonoHandlerContext<E>>;
    /**
     * Bind typed handlers to the contract or one of its route groups.
     */
    router: {
        <const GroupOrRoutes extends Extract<keyof Router<ServerContract<R, Schemes, Auth, RequestContext>, E>, string> | Routes>(
            group: GroupOrRoutes,
            router: GroupRouter<ServerContract<R, Schemes, Auth, RequestContext>, GroupOrRoutes, E>
        ): GroupRouter<ServerContract<R, Schemes, Auth, RequestContext>, GroupOrRoutes, E>;
        (router: Router<ServerContract<R, Schemes, Auth, RequestContext>, E>): Router<ServerContract<R, Schemes, Auth, RequestContext>, E>;
    };
    /**
     * Assemble the router and guards into the api object.
     */
    api(
        options: {
            router: Router<ServerContract<R, Schemes, Auth, RequestContext>, E>;
        } & (string extends keyof Schemes ? { guards?: undefined } : { guards: NoInfer<GuardsForSchemes<Schemes, E>> }) &
            (string extends keyof RequestContext
                ? { requestContext?: undefined }
                : { requestContext: NoInfer<{ [Name in keyof RequestContext]: RequestContextRun<HonoHandlerContext<E>> }> })
    ): HonoApi<R>;
}

/**
 * Bind a contract to a server handle: the server-side counterpart to `kizuna`'s
 * `k`.
 *
 * @example
 * const { server } = KizunaServer.init(contract);
 *
 * const requireUser = server.guard('user', ({ bearer, deny }) => {
 *     const session = bearer && sessions.get(bearer.token);
 *     return session ? { userId: session.userId } : deny(401, 'Unauthorized');
 * });
 *
 * export const api = server.api({
 *     router,
 *     guards: {
 *         user: requireUser,
 *     },
 * });
 */
const init = <
    const R extends Routes,
    Schemes extends Record<string, SecurityScheme>,
    Auth,
    RequestContext extends Record<string, RequestContextSchema>,
    E extends Env = Env,
>(
    contract: ServerContract<R, Schemes, Auth, RequestContext>
): { server: Server<R, Schemes, Auth, RequestContext, E> } => {
    const server = {
        guard: (_name: string, run: unknown) => run,
        requestContext: (_name: string, run: unknown) => run,
        router: (groupOrRouter: unknown, groupRouter?: unknown) => groupRouter ?? groupOrRouter,
        api: (options: ApiParts) => {
            const api = assembleApi(contract, options) as HonoApi<R>;
            return Object.assign(api, {
                mount: <E extends Env = Env>(app: Hono<E>, mountOptions?: HonoOptions) => mountHono(api, app, mountOptions),
            });
        },
    };
    return { server: server as unknown as Server<R, Schemes, Auth, RequestContext, E> };
};

/**
 * Bind a contract to a server handle. The serving counterpart to `Kizuna.init`.
 */
export const KizunaServer = { init };
