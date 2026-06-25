import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
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
    problemDetails,
} from '@ts-kizuna/core/adapter';
import type { Contract, TagOptions } from '@ts-kizuna/core';

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
 * The handler tree for a contract or route group, typed against it.
 */
export type Router<C> =
    C extends Contract<infer R, infer _Tags, infer _Codes>
        ? CoreRouter<R, FastifyHandlerContext>
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
    map: MiddlewareMap<R, FastifyPreHandler>
): MiddlewareMap<R, FastifyPreHandler> => map;

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
 * const requireAdmin = createGuard(async ({ request, deny }) => {
 *     if (request.user?.role !== 'admin') return deny(403, 'Forbidden');
 * });
 */
export function createGuard(
    guard: (args: {
        request: FastifyRequest;
        reply: FastifyReply;
        deny: Deny;
    }) => Promise<ReturnType<Deny> | void> | ReturnType<Deny> | void
): FastifyPreHandler {
    return async (request, reply) => {
        const result = await guard({ request, reply, deny });
        if (result && typeof result === 'object' && 'status' in result) {
            reply
                .header('content-type', 'application/problem+json')
                .status(result.status)
                .send(problemDetails(result.status, result.detail));
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
export const createApi = <const R extends Routes>(options: {
    contract: Contract<R, Record<string, TagOptions>, string>;
    router: Router<Contract<R>>;
    middleware?: MiddlewareMap<R, FastifyPreHandler>;
}): FastifyApi<R> => {
    const { contract, router, middleware } = options;
    const spec = coreApi(contract.routes);
    return Object.assign(spec, {
        [ROUTER_META]: router,
        [MIDDLEWARE_META]: middleware,
    }) as unknown as FastifyApi<R>;
};

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
