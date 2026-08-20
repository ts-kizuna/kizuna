import { z } from 'zod';
import type { RouteDefinition, Routes, Method } from './types.js';
import type { SecurityScheme } from './security-scheme.js';
import type { Credential, NoCredential } from './identity.js';
import {
    type RouteHandler,
    type Router,
    type RawInputs,
    type ValidationStage,
    allowedMethodsForPath,
    flattenRoutes,
    formatValidationError,
    validateRequest,
} from './handler-pipeline.js';
import { type MatchResult, matchRoute as defaultMatchRoute, sortFlattenedRoutes } from './route-matcher.js';
import { parsePath } from './path-params.js';
import { ResponseError } from './response-error.js';
import { problemDetails, type ProblemDetails } from './problem-details.js';
import { STATUS_TITLES } from './status-titles.js';
import { isVoidSchema, isBinarySchema } from './zod-internals.js';
import { resolveCoercionPlans } from './coercion.js';
import { isRawResponse, type RawResponse } from './raw-response.js';
import { pluginRouteTree, PLUGIN_ROUTES_META_KEY, PLUGIN_SERVERS_META_KEY, type ContractPlugins } from './plugin.js';
import { resolvePluginServers, type PluginImplementation } from './plugin-server.js';
import { resolveResponseBody, resolveResponseContentType, isJsonMediaType } from './generator-utils.js';
import { DEFAULT_JOBS_PATH, flattenJobs, type Jobs, type JobsConfig } from './jobs.js';
import { createJobRunner, jobFnAt, JobInputError, type JobRunner, type JobRunnerOptions, type JobErrorHandler } from './job-runner.js';
import {
    DispatchFailedSchema,
    DispatchResultSchema,
    JobRunRequestSchema,
    dispatchDueJobs,
    dispatchSucceeded,
    failedJobs,
} from './job-dispatch.js';
import { ProblemDetailsSchema } from './schemas.js';
import type { Contract } from './contract.js';
import type { JobTransport } from './job-transport.js';

export type { RouteDefinition, RoutePath, Routes, Method } from './types.js';
export { rawResponse, isRawResponse, type RawResponse } from './raw-response.js';
export {
    createPlugin,
    pluginRouteTree,
    type PluginDeclaration,
    type PluginDefinition,
    type PluginRoutes,
    type ContractPlugins,
    type PluginExportValues,
    type PluginArgs,
    type PluginRoutesOf,
    type PluginPropsOf,
    type PluginExportsOf,
} from './plugin.js';
export type { CompiledJob, Jobs, JobHandler, JobHandlers, FlattenedJob } from './jobs.js';
export { flattenJobs, isCompiledJob, jobAt } from './jobs.js';
export type {
    CompiledReceiver,
    Receivers,
    ReceiverHandler,
    ReceiverImplementation,
    ReceiverImplementations,
    ReceiverVerify,
    ReceiverVerifyArgs,
} from './receivers.js';
export { flattenReceivers, isCompiledReceiver, receiverDeny, ReceiverDenied } from './receivers.js';
export { receiverRouteKey, receiverRoutes, receiverRouter, warnUnimplementedReceivers, type ReceiversMeta } from './receiver-dispatch.js';
export {
    createJobRunner,
    jobFnAt,
    JobInputError,
    type JobRunner,
    type JobRunnerOptions,
    type JobErrorHandler,
    type JobFnByKey,
} from './job-runner.js';
export {
    createJobTransport,
    JobDispatchError,
    type JobTransport,
    type JobMessage,
    type JobDescriptor,
    type ScheduledJob,
    type JobWorker,
    type JobWorkerContext,
} from './job-transport.js';
export {
    implementPlugin,
    pluginRoutesOf,
    pluginRouterOf,
    pluginExportsOf,
    resolvePluginServers,
    type PluginImplementation,
    type PluginImplementations,
    type PluginServer,
    type PluginRouter,
} from './plugin-server.js';

export class ResponseValidationError extends Error {
    readonly routeKey: string;
    readonly status: number;
    readonly issues: z.core.$ZodIssue[];

    constructor(routeKey: string, status: number, issues: z.core.$ZodIssue[]) {
        super(`Response validation failed for ${routeKey} (status ${status})`);
        this.name = 'ResponseValidationError';
        this.routeKey = routeKey;
        this.status = status;
        this.issues = issues;
    }
}

export const API_META: unique symbol = Symbol('ts-kizuna.api.meta');
export const ROUTER_META: unique symbol = Symbol('ts-kizuna.router');
export const GUARDS_META: unique symbol = Symbol('ts-kizuna.guards');
export const SCHEMES_META: unique symbol = Symbol('ts-kizuna.schemes');
export const REQUEST_CONTEXT_META: unique symbol = Symbol('ts-kizuna.request-context');
const CONTRACT_META: unique symbol = Symbol.for('ts-kizuna.contract');
export const JOBS_META: unique symbol = Symbol('ts-kizuna.jobs');
export const RECEIVERS_META: unique symbol = Symbol('ts-kizuna.receivers');

export type ApiDefinition = { readonly [API_META]: true };
export type ApiWithRouter<R extends Routes = Routes> = ApiDefinition & {
    /**
     * The contract's route tree. Read it here rather than off the api object: the
     * api carries the parts that serve the routes, it is not the routes itself.
     */
    readonly routes: R;
    readonly [ROUTER_META]: Record<string, unknown>;
};

/**
 * The marker a guard's `deny(status, detail)` returns. Distinguishes a denial
 * from the context object a passing guard returns.
 */
const GUARD_DENY: unique symbol = Symbol('ts-kizuna.guard.deny');

/**
 * The result of `deny(status, detail)` inside a guard, short-circuits the
 * request with an RFC 9457 problem details response of the given status.
 */
export interface GuardDenial {
    readonly [GUARD_DENY]: true;
    status: number;
    detail: string;
}

/**
 * Reject the request from inside a guard.
 */
export type GuardDeny = (status: number, detail: string) => GuardDenial;

export const guardDeny: GuardDeny = (status, detail) => ({
    [GUARD_DENY]: true,
    status,
    detail,
});

export const isGuardDenial = (value: unknown): value is GuardDenial => typeof value === 'object' && value !== null && GUARD_DENY in value;

/**
 * The runtime behavior of a guard. It receives one object: the adapter's handler
 * context (e.g. `req`/`res`) plus the credential the identity's method extracted
 * from the request (or `null` if absent), a `deny` helper, and the matched
 * route's required `scopes`. It returns the context the scheme provides (nested
 * under `auth`, keyed by the identity's name in the handler args) or `deny(...)` to reject.
 */
export type GuardRun<HandlerContext = unknown> = (
    args: HandlerContext &
        Credential & {
            params: Record<string, string>;
            deny: GuardDeny;
            scopes: string[];
        }
) => Promise<Record<string, unknown> | GuardDenial | void> | Record<string, unknown> | GuardDenial | void;

/**
 * Guards keyed by the security scheme name they satisfy. A route's resolved
 * `security` selects which guards run before its handler.
 */
export type GuardMap<HandlerContext = unknown> = Record<string, GuardRun<HandlerContext>>;

/**
 * The runtime behavior of a request context resolver. It runs on every route
 * before the guards, receives the handler context plus the matched route's
 * `params`, and returns the value handlers read under the context's name. It
 * never denies a request.
 */
export type RequestContextRun<HandlerContext = unknown> = (
    args: HandlerContext & {
        params: Record<string, string>;
        headers: Record<string, string | string[] | undefined>;
    }
) => Promise<unknown> | unknown;

/**
 * The contract the api was assembled from, for plugins needing more than the routes.
 */
export const contractOf = <C = unknown>(api: unknown): C => (api as Record<symbol, unknown>)[CONTRACT_META] as C;

/**
 * What kizuna puts in handler args. Must agree with the spread in `runPipeline`.
 */
export const HANDLER_ARG_KEYS = ['params', 'query', 'body', 'headers', 'path', 'throwError', 'auth', 'requestContext', 'plugins'] as const;

/**
 * The adapter's own context, with kizuna's arguments removed.
 */
export const adapterContextOf = (args: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(args).filter(([key]) => !(HANDLER_ARG_KEYS as readonly string[]).includes(key)));

/**
 * Request context resolvers keyed by the name they were declared under on `new Kizuna()`.
 */
export type RequestContextMap<HandlerContext = unknown> = Record<string, RequestContextRun<HandlerContext>>;

const assertNoDuplicateRoutes = (routes: Routes, pluginRoutes: Routes = {}): void => {
    const seen = new Map<string, { routeKey: string; path: string }>();
    for (const { routeKey, route } of [...flattenRoutes(routes), ...flattenRoutes(pluginRoutes)]) {
        const { segments } = parsePath(route.path);
        const normalizedPath = segments.map((segment) => (segment.kind === 'param' ? ':*' : segment.value)).join('');
        const key = `${route.method}:${normalizedPath}`;
        const conflict = seen.get(key);
        if (conflict) {
            throw new Error(
                `Duplicate route: "${routeKey}" (${route.method} ${route.path}) conflicts with "${conflict.routeKey}" (${route.method} ${conflict.path})`
            );
        }
        seen.set(key, { routeKey, path: route.path });
    }
};

export interface ApiParts {
    router: unknown;
    guards?: unknown;
    requestContext?: unknown;
    /**
     * Each plugin's server half, keyed by install name.
     */
    plugins?: Record<string, PluginImplementation>;
}

/**
 * Brand a contract's routes with the parts that serve them, for the adapter to read back when mounting.
 */
export const assembleApi = <const R extends Routes>(
    contract: {
        routes: R;
        securitySchemes?: Record<string, SecurityScheme>;
        plugins?: ContractPlugins;
    },
    parts: ApiParts
): ApiWithRouter<R> => {
    const pluginRoutes = pluginRouteTree(contract.plugins);
    assertNoDuplicateRoutes(contract.routes, pluginRoutes);
    for (const { route } of [...flattenRoutes(contract.routes), ...flattenRoutes(pluginRoutes)]) {
        resolveCoercionPlans(route);
    }
    const api = {
        routes: contract.routes,
        [API_META]: true,
        [ROUTER_META]: parts.router,
        [GUARDS_META]: parts.guards,
        [SCHEMES_META]: contract.securitySchemes,
        [REQUEST_CONTEXT_META]: parts.requestContext,
        [PLUGIN_ROUTES_META_KEY]: pluginRoutes,
        [CONTRACT_META]: contract,
    } as Record<string | symbol, unknown>;

    // Resolved after the api exists, because a plugin's server half receives it.
    api[PLUGIN_SERVERS_META_KEY] = resolvePluginServers(contract.plugins, parts.plugins, api);

    return api as unknown as ApiWithRouter<R>;
};

/**
 * The endpoints jobs are served on, in the {@link Routes} shape the request
 * pipeline takes.
 */
export const jobRoutes = (meta: JobsMeta): Routes => ({
    [DISPATCH_ROUTE_KEY]: dispatchRoute(meta),
    [RUN_ROUTE_KEY]: runRoute(meta),
});

/**
 * Their handlers, in the {@link Router} shape the request pipeline takes.
 */
export const jobRouter = <HandlerContext>(meta: JobsMeta): Router<Routes, HandlerContext> =>
    ({
        [DISPATCH_ROUTE_KEY]: dispatchHandler<HandlerContext>(meta),
        [RUN_ROUTE_KEY]: runHandler<HandlerContext>(meta),
    }) as unknown as Router<Routes, HandlerContext>;

/**
 * The job runner an adapter hands to every handler, built from what
 * `server.jobs` stamped on the api.
 */
export interface ServerOptions {
    /**
     * Carries a queued job to whatever runs it. Without one, `queue` runs the job
     * in this process and it is lost on a crash.
     */
    jobTransport?: JobTransport;
    onJobError?: JobErrorHandler;
    /**
     * Called when a verifier or handler throws something that is not `deny` or
     * `throwError`.
     */
    onReceiverError?: (error: unknown, receiverKey: string) => void;
}

/**
 * Warn when a job asks for something its transport will drop.
 */
export const warnUnsupportedJobOptions = (
    jobs: Jobs | undefined,
    transport: JobTransport | undefined,
    logger: Pick<Console, 'warn'> = console
): void => {
    if (!jobs) return;
    const retrying = flattenJobs(jobs)
        .filter(({ job }) => job.definition.retry !== undefined)
        .map(({ jobKey }) => jobKey);
    if (retrying.length === 0) return;
    const named = retrying.map((jobKey) => `"${jobKey}"`).join(', ');
    if (!transport) {
        logger.warn(
            `[ts-kizuna] ${named} declare \`retry\`, but no transport is configured, so a failed run is not retried. ` +
                'Pass one as `jobTransport` to `new KizunaServer()` to make retrying real.'
        );
        return;
    }
    if (!transport.supports.retry) {
        logger.warn(
            `[ts-kizuna] ${named} declare \`retry\`, but the "${transport.name}" transport does not retry, so the count is ignored.`
        );
    }
};

/**
 * What `JOBS_META` carries: the contract's jobs, the handler for each, and how
 * this deployment runs them.
 */
export interface JobsMeta extends JobRunnerOptions {
    jobs: Jobs;
    handlers: Record<string, unknown>;
    config?: JobsConfig;
}

/**
 * Namespaced so it cannot collide with a route key of your own.
 */
export const DISPATCH_ROUTE_KEY = 'kizuna:dispatch';

/**
 * The endpoint a scheduler ticks to run whichever jobs are due.
 */
export const dispatchRoute = (meta: JobsMeta): RouteDefinition => {
    // Every job in a group shares one identity.
    const identity = flattenJobs(meta.jobs).find(({ job }) => job.identity !== undefined)?.job.identity;
    return {
        method: meta.config?.method ?? 'POST',
        path: `${meta.config?.path ?? DEFAULT_JOBS_PATH}/dispatch`,
        summary: 'Run every scheduled job due this minute',
        security: identity === undefined ? [] : [identity],
        responses: {
            200: DispatchResultSchema,
            503: DispatchFailedSchema,
        },
    } as unknown as RouteDefinition;
};

/**
 * Runs each due job rather than queueing it, so the transport never sees a tick.
 */
export const dispatchHandler = <HandlerContext>(meta: JobsMeta): RouteHandler<RouteDefinition, HandlerContext> => {
    const runner = createJobRunner(meta.jobs, meta.handlers as never, meta);
    const thunks: Record<string, () => Promise<unknown>> = {};
    for (const { jobKey } of flattenJobs(meta.jobs)) {
        const jobFn = jobFnAt(runner, jobKey);
        if (!jobFn) continue;
        thunks[jobKey] = () => jobFn.run();
    }
    return (async () => {
        const result = await dispatchDueJobs({ jobs: meta.jobs } as unknown as Contract, thunks, {
            windowMs: meta.config?.windowMs,
            only: meta.config?.only,
            exclude: meta.config?.exclude,
        });
        if (dispatchSucceeded(result)) {
            return {
                status: 200,
                body: result,
            };
        }
        const failed = failedJobs(result);
        return {
            status: 503,
            body: {
                detail: `${failed.length} of ${result.due.length} due jobs failed`,
                failed,
            },
        };
    }) as unknown as RouteHandler<RouteDefinition, HandlerContext>;
};

/**
 * Namespaced so it cannot collide with a route key of your own.
 */
export const RUN_ROUTE_KEY = 'kizuna:run';

/**
 * The endpoint a queue delivers one job to, naming it in the body.
 */
export const runRoute = (meta: JobsMeta): RouteDefinition => {
    const identity = flattenJobs(meta.jobs).find(({ job }) => job.identity !== undefined)?.job.identity;
    return {
        method: 'POST',
        path: `${meta.config?.path ?? DEFAULT_JOBS_PATH}/run`,
        summary: 'Run one job by name',
        security: identity === undefined ? [] : [identity],
        body: JobRunRequestSchema,
        responses: {
            200: z.unknown(),
            204: z.void(),
            404: ProblemDetailsSchema,
            422: ProblemDetailsSchema,
            500: ProblemDetailsSchema,
            503: ProblemDetailsSchema,
        },
    } as unknown as RouteDefinition;
};

/**
 * Answers with whatever the job answered, so a queue reads its own retry
 * contract off the status.
 */
export const runHandler = <HandlerContext>(meta: JobsMeta): RouteHandler<RouteDefinition, HandlerContext> => {
    const runner = createJobRunner(meta.jobs, meta.handlers as never, meta);
    return (async (args: { body: { job: string; input?: unknown } }) => {
        const { job, input } = args.body;
        const jobFn = jobFnAt(runner, job);
        if (!jobFn) {
            return {
                status: 404,
                body: {
                    detail: `No job named "${job}" on this contract.`,
                },
            };
        }
        try {
            return await jobFn.run(input);
        } catch (error) {
            if (error instanceof JobInputError) {
                return {
                    status: 422,
                    body: {
                        detail: `Input for job "${job}" failed validation.`,
                    },
                };
            }
            throw error;
        }
    }) as unknown as RouteHandler<RouteDefinition, HandlerContext>;
};

export const jobRunnerFrom = (meta: JobsMeta | undefined): JobRunner<Jobs> | undefined =>
    meta ? createJobRunner(meta.jobs, meta.handlers as never, meta) : undefined;

/**
 * The dotted keys of the jobs a handler was actually bound to. A job without one
 * cannot run, so nothing should schedule or subscribe to it.
 */
export const boundJobKeys = (meta: JobsMeta | undefined): Set<string> => {
    const bound = new Set<string>();
    if (!meta) return bound;
    for (const { jobKey } of flattenJobs(meta.jobs)) {
        let handler: unknown = meta.handlers;
        for (const segment of jobKey.split('.')) {
            if (!handler || typeof handler !== 'object') break;
            handler = (handler as Record<string, unknown>)[segment];
        }
        if (typeof handler === 'function') bound.add(jobKey);
    }
    return bound;
};
export type { FlattenedRoute, RouteHandler, Router, RawInputs, ValidationFailure, ValidationStage } from './handler-pipeline.js';
export { allowedMethodsForPath, flattenRoutes, formatValidationError, isRouteDefinition, validateRequest } from './handler-pipeline.js';
export { stripBasePath } from './route-matcher.js';
export type {
    HandlersFromAuth,
    GuardParams,
    GuardedParamNames,
    RequestContextValues,
    RoutesWithHandlerContext,
    BrandedHandlerContext,
    RouteAuthValue,
    ContextFromAuthValue,
} from './handler-pipeline.js';
export { buildPath, parsePath, type PathSegment } from './path-params.js';
export { sortFlattenedRoutes } from './route-matcher.js';
export { ROUTES_TAG, HANDLER_CONTEXT_BRAND, type HandlerContextBrand } from './types.js';
export { tagRoutes } from './routes.js';
export { isTagSet, type NormalizeTags } from './tags.js';
export { ResponseError } from './response-error.js';
export { problemDetails, type ProblemDetails } from './problem-details.js';
export type { MatchResult, RouteMatch } from './route-matcher.js';
export { matchRoute } from './route-matcher.js';

export type RouteMatcher = (method: string, path: string, routes: Routes, basePath?: string) => MatchResult;

export interface AdapterRequest<NativeRequest> {
    request: NativeRequest;
    method: string;
    /**
     * - `core-match`: core matches the path against the routes (Next-style catch-all routing).
     * - `pre-resolved`: adapter has already routed the request and tells core which route was matched (Express-style per-route registration).
     */
    resolution:
        | {
              kind: 'core-match';
              path: string;
          }
        | {
              kind: 'pre-resolved';
              routeKey: string;
              route: RouteDefinition;
              params: Record<string, string>;
              /**
               * The path as it was requested, including any `basePath`. A
               * `rawBody` route's handler is given it as `path`.
               */
              path?: string;
          };
    query: unknown;
    headers: unknown;
    readBody: (route: RouteDefinition) => Promise<unknown> | unknown;
}

/**
 * Outcome of `runPipeline`. The adapter's `respond` translates this to a native response.
 *
 * Note: `raw-response` is an escape hatch for `onError` overrides, its `response` is
 * cast back to the adapter's `NativeResponse` by `respond`.
 */
export type AdapterResult =
    | {
          kind: 'not-found';
      }
    | {
          kind: 'method-not-allowed';
          allowed: Method[];
      }
    | {
          kind: 'unsupported-media-type';
          expected: string;
          received: string;
      }
    | {
          kind: 'invalid-body';
          detail: string;
      }
    | {
          kind: 'validation-failed';
          stage: ValidationStage;
          detail: string;
          issues: z.core.$ZodIssue[];
      }
    | {
          kind: 'no-handler';
          routeKey: string;
      }
    | {
          kind: 'guard-denied';
          status: number;
          detail: string;
      }
    | {
          kind: 'handler-error';
          routeKey: string;
          route: RouteDefinition;
          error: unknown;
      }
    | {
          kind: 'success';
          routeKey: string;
          route: RouteDefinition;
          status: number;
          body: unknown;
          headers?: Record<string, string>;
      }
    | {
          kind: 'not-acceptable';
      }
    | {
          kind: 'raw-response';
          response: unknown;
      };

export interface AdapterDefinition<NativeRequest, NativeResponse, HandlerContext, ResponseContext = Record<string, never>> {
    buildHandlerContext: (request: AdapterRequest<NativeRequest>, context: ResponseContext) => HandlerContext | Promise<HandlerContext>;
    respond: (result: AdapterResult, context: ResponseContext) => NativeResponse | Promise<NativeResponse>;
    /**
     * Return an `AdapterResult` to override the default `handler-error` outcome; return `void` to let it pass through.
     */
    onError?: (error: unknown, request: AdapterRequest<NativeRequest>) => AdapterResult | void | Promise<AdapterResult | void>;
    matcher?: RouteMatcher;
}

export interface HandleArgs<NativeRequest, HandlerContext, ResponseContext, TRoutes extends Routes> {
    routes: TRoutes;
    router: Router<TRoutes, HandlerContext>;
    request: AdapterRequest<NativeRequest>;
    responseContext: ResponseContext;
    /**
     * Guards keyed by security scheme name. The matched route's resolved
     * `security` selects which run before its handler; their returned context is
     * merged into the handler args.
     */
    guards?: GuardMap<HandlerContext>;
    /**
     * The contract's identities keyed by name. The runtime extracts each required
     * scheme's credential from the request (per its declared location) and passes
     * it to that scheme's guard.
     */
    schemes?: Record<string, SecurityScheme>;
    /**
     * What each plugin exports, reaching handlers under `plugins`.
     */
    pluginExports?: Record<string, unknown>;
    /**
     * Request context resolvers keyed by name. Each runs on every route before
     * the guards; its value lands in the handler args under `requestContext`, keyed by its name.
     */
    requestContext?: RequestContextMap<HandlerContext>;
    /**
     * The contract's jobs bound to their handlers. Every handler receives it as
     * `jobs`, so a route can run a job in process without an HTTP hop.
     */
    jobs?: JobRunner<Jobs>;
    basePath?: string;
    responseValidation?: boolean;
}

/**
 * Expand a route's resolved `security` into the concrete (scheme, scopes) pairs
 * whose guards must run before the handler.
 */
export const resolveSecurityRequirements = (route: RouteDefinition): Array<{ scheme: string; scopes: string[] }> => {
    const requirements: Array<{ scheme: string; scopes: string[] }> = [];
    for (const entry of route.security ?? []) {
        if (typeof entry === 'string') {
            requirements.push({
                scheme: entry,
                scopes: [],
            });
            continue;
        }
        for (const [scheme, scopes] of Object.entries(entry)) {
            requirements.push({
                scheme,
                scopes: [...(scopes ?? [])],
            });
        }
    }
    return requirements;
};

/**
 * Read a raw header value as a single string: the first entry of an array
 * header, `undefined` when absent. For guards and request context resolvers on
 * adapters that expose raw header records.
 */
export const getHeaderValue = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
    return undefined;
};

const parseCookies = (cookieHeader: string | undefined): Record<string, string> => {
    const cookies: Record<string, string> = {};
    if (!cookieHeader) return cookies;
    for (const part of cookieHeader.split(';')) {
        const separator = part.indexOf('=');
        if (separator === -1) continue;
        const name = part.slice(0, separator).trim();
        if (name) cookies[name] = decodeURIComponent(part.slice(separator + 1).trim());
    }
    return cookies;
};

/**
 * Whether a guard's returned field satisfies a gate value. Array fields pass
 * when they contain an allowed value; scalar fields when they equal one.
 */
export const gatePermits = (value: unknown, allowed: unknown): boolean => {
    if (Array.isArray(value)) {
        return Array.isArray(allowed) ? allowed.some((entry) => value.includes(entry)) : value.includes(allowed);
    }
    return Array.isArray(allowed) ? allowed.includes(value) : value === allowed;
};

/**
 * Extract the credential an identity's authentication method expects from the
 * request, labelled with its scheme kind: the value of the named
 * header/query/cookie for `apiKey`, the decoded `username`/`password` for HTTP
 * `basic`, or the bearer token for everything else. The credential is `null`
 * when it is absent or malformed.
 */
export const extractCredential = (scheme: SecurityScheme, request: AdapterRequest<unknown>): Credential | NoCredential => {
    const openapi = scheme.openapi;
    // A custom identity has no scheme to read from; its guard reads the credential itself.
    if (!openapi) return {};
    const headers = (request.headers ?? {}) as Record<string, string | string[] | undefined>;

    if (openapi.type === 'apiKey') {
        let value: string | undefined;
        if (openapi.in === 'header') value = getHeaderValue(headers[openapi.name.toLowerCase()]);
        else if (openapi.in === 'cookie') value = parseCookies(getHeaderValue(headers['cookie']))[openapi.name];
        else {
            const query = (request.query ?? {}) as Record<string, unknown>;
            const queryValue = query[openapi.name];
            value = typeof queryValue === 'string' ? queryValue : undefined;
        }
        return { apiKey: value === undefined ? null : { in: openapi.in, name: openapi.name, value } };
    }

    const authorization = getHeaderValue(headers['authorization']);
    if (openapi.type === 'http' && openapi.scheme === 'basic') {
        let credentials: { username: string; password: string } | null = null;
        if (authorization && /^basic\s+/i.test(authorization)) {
            try {
                const decoded = atob(authorization.replace(/^basic\s+/i, ''));
                const separator = decoded.indexOf(':');
                if (separator !== -1) credentials = { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
            } catch {
                credentials = null;
            }
        }
        return { basic: credentials };
    }

    const bearer = authorization ? /^bearer\s+(.+)$/i.exec(authorization) : null;
    const token = bearer ? { token: bearer[1]! } : null;
    if (openapi.type === 'oauth2') return { oauth2: token };
    if (openapi.type === 'openIdConnect') return { openIdConnect: token };
    return { bearer: token };
};

export interface Adapter<NativeRequest, NativeResponse, HandlerContext, ResponseContext> {
    handle: <T extends Routes>(args: HandleArgs<NativeRequest, HandlerContext, ResponseContext, T>) => Promise<NativeResponse>;
    eachRoute: <T extends Routes>(
        routes: T,
        router: Router<T, HandlerContext>
    ) => Iterable<{
        routeKey: string;
        route: RouteDefinition;
        handler: RouteHandler<RouteDefinition, HandlerContext>;
    }>;
}

const resolveHandler = (handlers: unknown, routeKey: string): unknown => {
    const segments = routeKey.split('.');
    let current: unknown = handlers;
    for (const segment of segments) {
        if (!current || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[segment];
    }
    return current;
};

interface ResolvedRoute {
    routeKey: string;
    route: RouteDefinition;
    params: Record<string, string>;
}

const resolveRoute = (
    request: AdapterRequest<unknown>,
    routes: Routes,
    matcher: RouteMatcher,
    basePath: string | undefined
): { ok: true; resolved: ResolvedRoute } | { ok: false; result: AdapterResult } => {
    if (request.resolution.kind === 'pre-resolved') {
        return {
            ok: true,
            resolved: {
                routeKey: request.resolution.routeKey,
                route: request.resolution.route,
                params: request.resolution.params,
            },
        };
    }
    const matched = matcher(request.method, request.resolution.path, routes, basePath);
    if (matched.kind === 'not-found') {
        return {
            ok: false,
            result: {
                kind: 'not-found',
            },
        };
    }
    if (matched.kind === 'method-mismatch') {
        return {
            ok: false,
            result: {
                kind: 'method-not-allowed',
                allowed: matched.allowed,
            },
        };
    }
    return {
        ok: true,
        resolved: {
            routeKey: matched.match.routeKey,
            route: matched.match.route,
            params: matched.match.params,
        },
    };
};

const isAcceptable = (acceptHeader: string | undefined): boolean => {
    if (!acceptHeader || acceptHeader.trim() === '') return true;
    for (const part of acceptHeader.split(',')) {
        const [mediaType = ''] = part.trim().split(';');
        const normalized = mediaType.trim().toLowerCase();
        if (normalized === '*/*' || normalized === 'application/*' || normalized === 'application/json') {
            return true;
        }
    }
    return false;
};

const runPipeline = async <NativeRequest, HandlerContext, ResponseContext>(
    request: AdapterRequest<NativeRequest>,
    routes: Routes,
    router: Router<Routes, HandlerContext>,
    definition: AdapterDefinition<NativeRequest, unknown, HandlerContext, ResponseContext>,
    responseContext: ResponseContext,
    guards: GuardMap<HandlerContext> | undefined,
    schemes: Record<string, SecurityScheme> | undefined,
    contextResolvers: RequestContextMap<HandlerContext> | undefined,
    pluginExports: Record<string, unknown> | undefined,
    jobRunner: JobRunner<Jobs> | undefined,
    basePath: string | undefined,
    responseValidation: boolean | undefined
): Promise<AdapterResult> => {
    const matcher = definition.matcher ?? defaultMatchRoute;
    const resolution = resolveRoute(request as AdapterRequest<unknown>, routes, matcher, basePath);
    if (!resolution.ok) return resolution.result;
    const { routeKey, route, params } = resolution.resolved;

    const raw: RawInputs = {
        params,
        query: request.query,
        headers: request.headers,
        body: undefined,
    };

    const acceptHeader = (raw.headers as Record<string, string | undefined>)['accept'];
    if (!isAcceptable(acceptHeader)) {
        return {
            kind: 'not-acceptable',
        };
    }

    const requestPath =
        request.resolution.kind === 'core-match' ? request.resolution.path : (request.resolution.path ?? `${basePath ?? ''}${route.path}`);

    if (route.rawBody) {
        try {
            raw.body = await request.readBody(route);
        } catch {
            return {
                kind: 'invalid-body',
                detail: 'Bad Request',
            };
        }
    } else if (route.body && !isVoidSchema(route.body)) {
        const expected = route.contentType ?? 'application/json';
        const contentTypeHeader = (raw.headers as Record<string, string | undefined>)['content-type'] ?? '';
        // No content type is no representation, not an unsupported one (RFC 9110 §15.5.16).
        const absent = contentTypeHeader === '' && route.body.safeParse(undefined).success;
        if (!absent) {
            const [mediaType = ''] = contentTypeHeader.split(';');
            const received = mediaType.trim();
            if (received.toLowerCase() !== expected) {
                return {
                    kind: 'unsupported-media-type',
                    expected,
                    received,
                };
            }
            try {
                raw.body = await request.readBody(route);
            } catch {
                return {
                    kind: 'invalid-body',
                    detail: 'Bad Request',
                };
            }
        }
    }

    const validation = validateRequest(route, raw);
    if (!validation.ok) {
        const formatted = formatValidationError(validation.error);
        return {
            kind: 'validation-failed',
            stage: validation.error.stage,
            detail: formatted.detail,
            issues: formatted.issues,
        };
    }

    const handler = resolveHandler(router, routeKey);
    if (typeof handler !== 'function') {
        return {
            kind: 'no-handler',
            routeKey,
        };
    }

    try {
        const handlerContext = await definition.buildHandlerContext(request, responseContext);

        const requestContext: Record<string, unknown> = {};
        if (contextResolvers) {
            for (const [name, resolver] of Object.entries(contextResolvers)) {
                requestContext[name] = await resolver({
                    ...(handlerContext as Record<string, unknown>),
                    params,
                    headers: raw.headers as Record<string, string | string[] | undefined>,
                } as Parameters<typeof resolver>[0]);
            }
        }

        const securityContext: Record<string, unknown> = {};
        for (const { scheme, scopes } of resolveSecurityRequirements(route)) {
            const guard = guards?.[scheme];
            if (!guard) {
                throw new Error(`No guard registered for security scheme "${scheme}" required by route "${routeKey}".`);
            }
            const schemeDefinition = schemes?.[scheme];
            const credential = schemeDefinition ? extractCredential(schemeDefinition, request as AdapterRequest<unknown>) : {};
            const guardResult = await guard({
                ...(handlerContext as Record<string, unknown>),
                ...credential,
                params,
                deny: guardDeny,
                scopes,
            } as Parameters<typeof guard>[0]);
            if (isGuardDenial(guardResult)) {
                return {
                    kind: 'guard-denied',
                    status: guardResult.status,
                    detail: guardResult.detail,
                };
            }
            if (guardResult && typeof guardResult === 'object') {
                const gate = route.accessGate?.[scheme];
                if (gate) {
                    for (const [field, allowed] of Object.entries(gate)) {
                        const value = (guardResult as Record<string, unknown>)[field];
                        const permitted = gatePermits(value, allowed);
                        if (!permitted) {
                            return {
                                kind: 'guard-denied',
                                status: 403,
                                detail: `Forbidden: ${scheme}.${field} is not permitted on this route.`,
                            };
                        }
                    }
                }
                securityContext[scheme] = guardResult;
            }
        }

        const throwError = (response: { status: number; body: unknown; headers?: Record<string, string> }): never => {
            throw new ResponseError(response);
        };
        const handlerResult = await (
            handler as (args: unknown) => Promise<{ status: number; body: unknown; headers?: Record<string, string> } | RawResponse>
        )({
            params: validation.parsed.params,
            query: validation.parsed.query,
            body: validation.parsed.body,
            headers: validation.parsed.headers,
            throwError,
            ...(route.rawBody ? { path: requestPath } : {}),
            ...handlerContext,
            ...(jobRunner ? { jobs: jobRunner } : {}),
            ...(Object.keys(requestContext).length > 0 ? { requestContext } : {}),
            ...(Object.keys(securityContext).length > 0 ? { auth: securityContext } : {}),
            ...(pluginExports && Object.keys(pluginExports).length > 0 ? { plugins: pluginExports } : {}),
        });
        if (isRawResponse(handlerResult)) {
            return {
                kind: 'raw-response',
                response: handlerResult.response,
            };
        }
        if (responseValidation) {
            const responseSpec = route.responses[handlerResult.status];
            if (responseSpec !== undefined) {
                const bodySchema = 'safeParse' in responseSpec ? responseSpec : responseSpec.body;
                // Error responses (status >= 400) auto-fill the Problem Details envelope
                // (`type`/`title`/`status`) at render time, so the handler only supplies
                // `detail` plus extensions. Validate the final wire shape, not the partial
                // body, otherwise every valid error handler would fail validation.
                const bodyToValidate =
                    handlerResult.status >= 400 && handlerResult.body !== null && typeof handlerResult.body === 'object'
                        ? {
                              type: 'about:blank',
                              title: STATUS_TITLES[handlerResult.status] ?? 'Unknown Error',
                              status: handlerResult.status,
                              ...(handlerResult.body as Record<string, unknown>),
                          }
                        : handlerResult.body;
                const parseResult = bodySchema.safeParse(bodyToValidate);
                if (!parseResult.success) {
                    throw new ResponseValidationError(routeKey, handlerResult.status, parseResult.error.issues);
                }
            }
        }
        const successHeaders =
            route.method === 'OPTIONS'
                ? {
                      Allow: allowedMethodsForPath(routes, route.path).join(', '),
                      ...(handlerResult.headers ?? {}),
                  }
                : handlerResult.headers;
        return {
            kind: 'success',
            routeKey,
            route,
            status: handlerResult.status,
            body: route.method === 'HEAD' ? undefined : handlerResult.body,
            headers: successHeaders,
        };
    } catch (error) {
        if (error instanceof ResponseError) {
            return {
                kind: 'success',
                routeKey,
                route,
                status: error.status,
                body: error.body,
                headers: error.headers ?? {},
            };
        }
        if (definition.onError) {
            try {
                const override = await definition.onError(error, request);
                if (override) return override;
            } catch (hookError) {
                console.error('[ts-kizuna] onError hook threw:', hookError);
            }
        }
        return {
            kind: 'handler-error',
            routeKey,
            route,
            error,
        };
    }
};

export const createAdapter = <NativeRequest, NativeResponse, HandlerContext, ResponseContext = Record<string, never>>(
    definition: AdapterDefinition<NativeRequest, NativeResponse, HandlerContext, ResponseContext>
): Adapter<NativeRequest, NativeResponse, HandlerContext, ResponseContext> => ({
    handle: async ({
        routes,
        router,
        request,
        responseContext,
        guards,
        schemes,
        requestContext,
        pluginExports,
        jobs,
        basePath,
        responseValidation,
    }) => {
        const result = await runPipeline(
            request,
            routes,
            router as Router<Routes, HandlerContext>,
            definition as AdapterDefinition<NativeRequest, unknown, HandlerContext, ResponseContext>,
            responseContext,
            guards,
            schemes,
            requestContext,
            pluginExports,
            jobs,
            basePath,
            responseValidation
        );
        return definition.respond(result, responseContext);
    },
    eachRoute: function* (routes, router) {
        const sorted = sortFlattenedRoutes(flattenRoutes(routes));
        let mounted = 0;
        for (const { routeKey, route } of sorted) {
            const handler = resolveHandler(router, routeKey);
            if (typeof handler !== 'function') continue;
            mounted += 1;
            yield {
                routeKey,
                route,
                handler: handler as RouteHandler<RouteDefinition, HandlerContext>,
            };
        }
        if (sorted.length > 0 && mounted === 0) {
            throw new Error(
                `ts-kizuna mounted 0 of ${sorted.length} routes: no handler resolved for any route key (first was '${sorted[0]!.routeKey}'). ` +
                    `The router's shape does not match the contract's route keys.`
            );
        }
    },
});

/**
 * Decides the bytes that go on the wire for an error (status >= 400). The default emits the
 * canonical RFC 9457 Problem Details as `application/problem+json`.
 *
 * **Most migrations don't need this.** Carrying your existing fields as Problem Details
 * extension members keeps a single body valid for both old and new clients.
 *
 * **Reach for it only when** an older client needs a different content type (plain
 * `application/json`) or a structurally different body. It receives the request, so if you
 * can tell clients apart (a version header, `Accept`, …) you can serve the legacy shape to
 * old clients and Problem Details to new ones during a transition, then delete it.
 */
export type ErrorFormatter<NativeRequest = unknown> = (
    problem: ProblemDetails & Record<string, unknown>,
    context: {
        status: number;
        request: NativeRequest;
    }
) => {
    contentType: string;
    body: unknown;
};

const defaultErrorFormatter: ErrorFormatter = (problem) => ({
    contentType: 'application/problem+json',
    body: problem,
});

const describeBodyType = (body: unknown): string => {
    if (body === null) return 'null';
    if (Array.isArray(body)) return 'an array';
    return `a value of type ${typeof body}`;
};

/**
 * Maps an `AdapterResult` to `{ status, headers, body }` using ts-kizuna's default
 * JSON conventions (e.g. 405 with an `Allow` header, 400 with `{ detail, errors }`
 * for validation failures). Adapters that speak JSON delegate `respond` to this
 * instead of writing the switch by hand.
 *
 * Every error (status >= 400) is an RFC 9457 Problem Details object run through
 * `formatError`, there is no custom-error-shape passthrough. Pass an `ErrorFormatter`
 * to reshape the wire bytes for migration; the canonical problem is unchanged.
 *
 * `raw-response` is excluded, it carries a framework-specific `NativeResponse`
 * the adapter must return directly, so handle that case before calling this.
 */
export const renderJsonResult = (
    result: Exclude<AdapterResult, { kind: 'raw-response' }>,
    formatError: ErrorFormatter = defaultErrorFormatter,
    request: unknown = undefined
): { status: number; headers: Record<string, string>; body: unknown; raw?: boolean } => {
    const renderError = (
        status: number,
        detail: string,
        extensions?: Record<string, unknown>,
        extraHeaders?: Record<string, string>
    ): { status: number; headers: Record<string, string>; body: unknown } => {
        const problem = problemDetails(status, detail, extensions);
        const { contentType, body } = formatError(problem, { status, request });
        return {
            status,
            headers: {
                'content-type': contentType,
                ...(extraHeaders ?? {}),
            },
            body,
        };
    };

    switch (result.kind) {
        case 'success': {
            if (result.status >= 400) {
                const body = result.body;
                const extensions = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
                const detail = typeof extensions.detail === 'string' ? extensions.detail : (STATUS_TITLES[result.status] ?? 'Error');
                return renderError(result.status, detail, extensions, result.headers);
            }
            if (result.body === undefined) {
                return {
                    status: result.status,
                    headers: {
                        ...(result.headers ?? {}),
                    },
                    body: result.body,
                };
            }
            const responseSpec = result.route.responses[result.status];
            const isBinary = responseSpec !== undefined && isBinarySchema(resolveResponseBody(responseSpec));
            const contentType = resolveResponseContentType(responseSpec) ?? (isBinary ? 'application/octet-stream' : 'application/json');
            const raw = isBinary || !isJsonMediaType(contentType);
            if (raw && typeof result.body !== 'string' && !(result.body instanceof Uint8Array)) {
                throw new Error(
                    `${result.routeKey} (status ${result.status}) is declared with content type "${contentType}", so its body must be a string or Uint8Array, but the handler returned ${describeBodyType(result.body)}.`
                );
            }
            return {
                status: result.status,
                headers: {
                    'content-type': contentType,
                    ...(result.headers ?? {}),
                },
                body: result.body,
                raw,
            };
        }
        case 'not-found':
            return renderError(404, 'Not Found');
        case 'method-not-allowed':
            return renderError(
                405,
                'Method Not Allowed',
                {
                    allowed: result.allowed,
                },
                {
                    Allow: result.allowed.join(', '),
                }
            );
        case 'invalid-body':
            return renderError(400, result.detail);
        case 'validation-failed':
            return renderError(400, result.detail, {
                errors: result.issues.map((issue) => ({
                    code: issue.code ?? 'custom',
                    path: issue.path,
                    message: issue.message,
                })),
            });
        case 'no-handler':
            return renderError(500, `Handler not implemented: ${result.routeKey}`);
        case 'guard-denied':
            return renderError(result.status, result.detail);
        case 'unsupported-media-type':
            return renderError(415, `Unsupported Media Type: expected ${result.expected}, received ${result.received}`);
        case 'not-acceptable':
            return renderError(406, 'Not Acceptable');
        case 'handler-error':
            return renderError(500, 'Internal Server Error');
    }
};

const formDataToObject = (form: FormData): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of form.entries()) {
        const existing = result[key];
        if (existing === undefined) {
            result[key] = value;
        } else if (Array.isArray(existing)) {
            existing.push(value);
        } else {
            result[key] = [existing, value];
        }
    }
    return result;
};

/**
 * Content-type-aware body parser for Web Fetch `Request`.
 *
 * Reusable across any Fetch-based adapter.
 *
 * */
export const parseFetchBody = async (request: Request, route: RouteDefinition): Promise<unknown> => {
    if (route.rawBody) return new Uint8Array(await request.arrayBuffer());
    switch (route.contentType) {
        case 'multipart/form-data':
            return formDataToObject(await request.formData());
        case 'application/x-www-form-urlencoded':
            return Object.fromEntries(new URLSearchParams(await request.text()));
        default: {
            const text = await request.text();
            return text.length > 0 ? JSON.parse(text) : undefined;
        }
    }
};

export const headersToObject = (headers: Headers): Record<string, string> => {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
        result[key] = value;
    });
    return result;
};
