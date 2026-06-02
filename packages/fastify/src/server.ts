import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import {
    type AdapterRequest,
    type RouteDefinition,
    type Contract,
    type MiddlewareMap,
    type RouteHandler as CoreRouteHandler,
    type Router as CoreRouter,
    type ApiWithRouter,
    type ErrorFormatter,
    ROUTER_META,
    MIDDLEWARE_META,
    createAdapter,
    createApi as coreCreateApi,
    resolveMiddleware,
    renderJsonResult,
    problemDetails,
} from '@ts-kizuna/core/adapter';

export type FastifyApi<R extends Contract = Contract> = R & ApiWithRouter & { readonly [MIDDLEWARE_META]?: unknown };

export interface FastifyHandlerContext {
    request: FastifyRequest;
    reply: FastifyReply;
}

export type RouteHandler<R extends RouteDefinition> = CoreRouteHandler<R, FastifyHandlerContext>;
export type Router<T extends Contract> = CoreRouter<T, FastifyHandlerContext>;

declare module 'fastify' {
    interface FastifyRequest {
        kizunaRoute?: RouteDefinition;
    }
}

export type FastifyPreHandler = (request: FastifyRequest, reply: FastifyReply) => void | Promise<void>;

export interface FastifyOptions {
    /**
     * Validate handler return values against the contract's response schemas.
     * Mismatches surface as 500 errors. Intended for development; disable in production.
     *
     * @default false
     */
    responseValidation?: boolean;
    /**
     * Reshape error (status >= 400) response bytes — e.g. serve an older client a plain
     * `application/json` body during migration. Most migrations don't need this (use Problem
     * Details extension members instead). See {@link ErrorFormatter}.
     */
    formatError?: ErrorFormatter<FastifyRequest>;
}

/**
 * Bind typed handler implementations to a contract.
 *
 * ```ts
 * import { createRouter } from '@ts-kizuna/fastify';
 * import { contract } from './contract';
 *
 * export const router = createRouter(contract, {
 *     listUsers: ({ query }) => ({ status: 200, body: { users: [], total: 0 } }),
 *     createUser: ({ body }) => ({ status: 201, body: { id: '1', ...body } }),
 * });
 * ```
 */
export const createRouter = <T extends Contract>(_contract: T, router: Router<T>): Router<T> => router;

/**
 * Declare per-route middleware in the same shape as the contract.
 *
 * ```ts
 * import { createMiddleware } from '@ts-kizuna/fastify';
 * import { contract } from './contract';
 *
 * export const middleware = createMiddleware(contract, {
 *     listUsers: [authenticate],
 *     createUser: [authenticate, adminOnly],
 * });
 * ```
 */
export const createMiddleware = <T extends Contract>(
    _contract: T,
    map: MiddlewareMap<T, FastifyPreHandler>
): MiddlewareMap<T, FastifyPreHandler> => map;

type Deny = (status: number, detail: string) => { status: number; detail: string };

const deny: Deny = (status, detail) => ({
    status,
    detail,
});

/**
 * Create a guard — a middleware that checks access before the handler runs.
 *
 * Call `deny(status, message)` to reject the request.
 * Return without calling `deny` to allow it through.
 *
 * ```ts
 * import { createGuard } from '@ts-kizuna/fastify';
 *
 * const requireAdmin = createGuard(async (request, reply, deny) => {
 *     if (request.user.role !== 'admin') {
 *         return deny(403, 'Forbidden');
 *     }
 * });
 * ```
 */
export function createGuard(
    guard: (request: FastifyRequest, reply: FastifyReply, deny: Deny) => Promise<ReturnType<Deny> | void> | ReturnType<Deny> | void
): FastifyPreHandler {
    return async (request, reply) => {
        const result = await guard(request, reply, deny);
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
        } else {
            reply.status(rendered.status).send(rendered.body);
        }
    },
});

/**
 * Define a fully-typed Fastify API — routes, handlers, and middleware in one call.
 *
 * ```ts
 * import { createApi } from '@ts-kizuna/fastify';
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
export const createApi = <const R extends Contract>(options: {
    contract: R;
    router: Router<R>;
    middleware?: MiddlewareMap<R, FastifyPreHandler>;
}): FastifyApi<R> => {
    const { contract, router, middleware } = options;
    const spec = coreCreateApi(contract);
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
 * ```ts
 * import Fastify from 'fastify';
 * import { fastifyKizuna } from '@ts-kizuna/fastify';
 * import { api } from './api';
 *
 * const app = Fastify();
 * app.register(fastifyKizuna, {
 *     api,
 * });
 *
 * app.listen({ port: 3000 });
 * ```
 */
export const fastifyKizuna = fastifyPlugin(
    async (app: FastifyInstance, options: KizunaPluginOptions) => {
        const { api } = options;
        const resolvedRouter = api[ROUTER_META] as Router<Contract>;
        const middlewareMap = api[MIDDLEWARE_META] as MiddlewareMap<Contract, FastifyPreHandler> | undefined;

        for (const { routeKey, route } of adapter.eachRoute(api as unknown as Contract, resolvedRouter)) {
            const routeMiddleware = resolveMiddleware(routeKey, middlewareMap);

            app.route({
                method: route.method,
                url: route.path,
                preHandler: [
                    async (request: FastifyRequest) => {
                        request.kizunaRoute = route;
                    },
                    ...(routeMiddleware as any[]),
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
                        contract: api as unknown as Contract,
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
