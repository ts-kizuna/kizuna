import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
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

export type FastifyApi<R extends Routes = Routes> = R & ApiWithRouter & { readonly [MIDDLEWARE_META]?: unknown };

export interface FastifyHandlerContext {
    request: FastifyRequest;
    reply: FastifyReply;
}

/**
 * The handler type for a single route, typed against its contract definition.
 */
export type RouteHandler<R extends RouteDefinition> = CoreRouteHandler<R, FastifyHandlerContext>;

/**
 * The handler tree for a contract, typed against it.
 */
export type Router<C> =
    C extends Contract<infer R, infer _Tags, infer _Codes, infer Mode, infer _GuardError>
        ? CoreRouter<R, FastifyHandlerContext, Mode>
        : C extends Routes
          ? CoreRouter<C, FastifyHandlerContext>
          : never;

declare module 'fastify' {
    interface FastifyRequest {
        kizunaRoute?: RouteDefinition;
    }
}

export type FastifyPreHandler = (request: FastifyRequest, reply: FastifyReply) => void | Promise<void>;

export interface FastifyOptions {
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
    formatError?: ErrorFormatter<FastifyRequest>;
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
    map: MiddlewareMap<ContractRoutes<C>, FastifyPreHandler>
): MiddlewareMap<ContractRoutes<C>, FastifyPreHandler> => map;

/**
 * Rejects a request from inside a guard. `deny(status, detail)` is shorthand for a
 * Problem Details body; `deny(status, body)` sends a custom body (typed from the
 * contract's `guardErrorSchema`).
 */
interface Deny<Body = unknown> {
    (status: number, detail: string): GuardDenial;
    (status: number, body: Body): GuardDenial;
}

type GuardFn<Body> = (args: {
    request: FastifyRequest;
    reply: FastifyReply;
    deny: Deny<Body>;
}) => Promise<GuardDenial | void> | GuardDenial | void;

/**
 * Create a guard — a middleware that checks access before the handler runs. Call
 * `deny(...)` to reject the request; return without calling it to allow.
 *
 * Pass the contract first (`createGuard(contract, fn)`) to type `deny`'s body against the
 * contract's `guardErrorSchema` and render denials in the contract's error mode.
 *
 * @example
 * const requireAdmin = createGuard(contract, async ({ request, deny }) => {
 *     if (request.user?.role !== 'admin') return deny(403, 'Forbidden');
 * });
 */
export function createGuard(guard: GuardFn<unknown>): FastifyPreHandler;
export function createGuard<const C extends AnyContract>(contract: C, guard: GuardFn<DenyBody<C>>): FastifyPreHandler;
export function createGuard(contractOrGuard: Contract | GuardFn<unknown>, maybeGuard?: GuardFn<unknown>): FastifyPreHandler {
    const contract = typeof contractOrGuard === 'function' ? undefined : contractOrGuard;
    const guard = (typeof contractOrGuard === 'function' ? contractOrGuard : maybeGuard) as GuardFn<unknown>;
    const useProblemDetails = contract ? usesProblemDetails(contract.routes) : true;
    const deny = ((status: number, bodyOrDetail: unknown) => guardDenial(status, bodyOrDetail)) as Deny<unknown>;
    return async (request, reply) => {
        const result = await guard({ request, reply, deny });
        if (isGuardDenial(result)) {
            const rendered = renderGuardDenial(result, useProblemDetails);
            for (const [key, value] of Object.entries(rendered.headers)) {
                reply.header(key, value);
            }
            if (rendered.raw) {
                const body = rendered.body;
                // Strings go out as-is; binary is sent as bytes — never JSON-serialized.
                reply
                    .status(rendered.status)
                    .send(typeof body === 'string' || Buffer.isBuffer(body) ? body : Buffer.from(body as Uint8Array));
            } else {
                reply.status(rendered.status).send(rendered.body);
            }
        }
    };
}

interface FastifyResponseContext {
    reply: FastifyReply;
    formatError?: ErrorFormatter<FastifyRequest>;
}

const adapter = createAdapter<FastifyRequest, void, FastifyHandlerContext, FastifyResponseContext>({
    buildHandlerContext: (adapterRequest, { reply }) => ({
        request: adapterRequest.request,
        reply,
    }),
    respond: (result, { reply, formatError }) => {
        if (result.kind === 'handler-error') {
            throw result.error;
        }
        if (result.kind === 'raw-response') {
            return;
        }
        const rendered = renderJsonResult(result, formatError as ErrorFormatter, reply.request);
        for (const [key, value] of Object.entries(rendered.headers)) {
            reply.header(key, value);
        }
        if (rendered.body === undefined) {
            reply.status(rendered.status).send();
        } else if (rendered.raw) {
            const body = rendered.body;
            // Strings go out as-is; binary (Uint8Array/Buffer) is sent as bytes — never JSON-serialized.
            reply.status(rendered.status).send(typeof body === 'string' || Buffer.isBuffer(body) ? body : Buffer.from(body as Uint8Array));
        } else {
            reply.status(rendered.status).send(rendered.body);
        }
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
export function createApi<const R extends Routes>(options: {
    contract: ContractOf<R, 'problem-details'>;
    router: Router<ContractOf<R, 'problem-details'>>;
    middleware?: MiddlewareMap<R, FastifyPreHandler>;
}): FastifyApi<R>;
export function createApi<const R extends Routes>(options: {
    contract: ContractOf<R, 'custom'>;
    router: Router<ContractOf<R, 'custom'>>;
    middleware?: MiddlewareMap<R, FastifyPreHandler>;
}): FastifyApi<R>;
export function createApi(options: any): FastifyApi {
    const { contract, router, middleware } = options;
    const spec = coreApi(contract.routes);
    return Object.assign(spec, {
        [ROUTER_META]: router,
        [MIDDLEWARE_META]: middleware,
    }) as unknown as FastifyApi;
}

export interface KizunaPluginOptions extends FastifyOptions {
    /**
     * The API object created with `createApi`.
     */
    api: FastifyApi;
}

/**
 * Fastify plugin that mounts a ts-kizuna API.
 *
 * @example
 * const app = Fastify();
 * app.register(fastifyKizuna, {
 *     api,
 * });
 */
export const fastifyKizuna = fastifyPlugin(
    async (app: FastifyInstance, options: KizunaPluginOptions) => {
        const { api } = options;
        const resolvedRouter = api[ROUTER_META] as CoreRouter<Routes, FastifyHandlerContext>;
        const middlewareMap = api[MIDDLEWARE_META] as MiddlewareMap<Routes, FastifyPreHandler> | undefined;

        for (const { routeKey, route } of adapter.eachRoute(api as unknown as Routes, resolvedRouter)) {
            const routeMiddleware = resolveMiddleware(routeKey, middlewareMap);

            app.route({
                method: route.method,
                url: route.path,
                preHandler: [
                    async (request: FastifyRequest) => {
                        request.kizunaRoute = route;
                    },
                    ...routeMiddleware,
                ],
                handler: async (request: FastifyRequest, reply: FastifyReply) => {
                    const adapterRequest: AdapterRequest<FastifyRequest> = {
                        request,
                        method: request.method,
                        resolution: {
                            kind: 'pre-resolved',
                            routeKey,
                            route,
                            params: (request.params ?? {}) as Record<string, string>,
                        },
                        query: (request.query ?? {}) as Record<string, string>,
                        headers: request.headers,
                        readBody: () => request.body,
                    };

                    await adapter.handle({
                        routes: api as unknown as Routes,
                        router: resolvedRouter,
                        request: adapterRequest,
                        responseContext: {
                            reply,
                            formatError: options?.formatError,
                        },
                        responseValidation: options?.responseValidation,
                    });
                },
            });
        }
    },
    {
        name: '@ts-kizuna/fastify',
    }
);
