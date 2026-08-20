import type { z } from 'zod';
import type { Contract, RoutesOf, SchemesOf, AuthOf, RequestContextOf, ContractPluginsOf, JobsOf, ReceiversOf } from './contract.js';
import type { Routes } from './types.js';
import type { SecurityScheme } from './security-scheme.js';
import type { CredentialOf } from './identity.js';
import type { RequestContextSchema, RequestContextHeaderValues } from './request-context.js';
import type { JobHandlers, JobsArg } from './jobs.js';
import type { PluginArgs } from './plugin.js';
import type { PluginImplementations } from './plugin-server.js';
import type { ReceiverImplementation, ReceiverImplementations, ReceiverVerify } from './receivers.js';
import type { ReceiversMeta } from './receiver-dispatch.js';
import { warnUnimplementedReceivers } from './receiver-dispatch.js';
import type {
    GuardSuccess,
    HandlersFromAuth,
    GuardParams,
    RequestContextValues,
    Router as CoreRouter,
    RouteHandler as CoreRouteHandler,
} from './handler-pipeline.js';
import type { RouteDefinition } from './types.js';
import {
    assembleApi,
    warnUnsupportedJobOptions,
    JOBS_META,
    RECEIVERS_META,
    type ApiParts,
    type ApiWithRouter,
    type GuardDeny,
    type GuardDenial,
    type GuardRun,
    type RequestContextRun,
    type ServerOptions,
} from './adapter.js';

/**
 * The handler for a single route, typed against its contract definition.
 */
export type RouteHandlerFor<R extends RouteDefinition, HandlerContext> = CoreRouteHandler<R, HandlerContext>;

/**
 * The handler tree for a contract or route group, typed against it. Routes
 * secured by the contract's `auth` map additionally receive each required
 * identity's context in their handler args, under `auth`, keyed by the
 * identity's name.
 */
export type ContractRouter<C, HandlerContext> = C extends Contract
    ? HandlersFromAuth<
          RoutesOf<C>,
          HandlerContext & RequestContextValues<RequestContextOf<C>> & PluginArgs<ContractPluginsOf<C>> & JobsArg<JobsOf<C>>,
          SchemesOf<C>,
          AuthOf<C>
      >
    : C extends Routes
      ? CoreRouter<C, HandlerContext>
      : never;

/**
 * The handler for each of a contract's scheduled jobs. Each receives only the
 * job's `input`, so the same handler can be run in process.
 */
export type ContractJobsRouter<C> = C extends Contract ? JobHandlers<JobsOf<C>> : never;

/**
 * The handlers for a group named on the contract, or for a bare route group.
 * Both forms resolve through one signature: a second candidate of the same
 * arity costs zero-argument handlers their contextual type.
 */
export type ContractGroupRouter<Source, GroupOrRoutes, HandlerContext> = GroupOrRoutes extends string
    ? ContractRouter<Source, HandlerContext>[Extract<GroupOrRoutes, keyof ContractRouter<Source, HandlerContext>>]
    : ContractRouter<GroupOrRoutes, HandlerContext>;

/**
 * A guard per identity, keyed by name. Each receives the handler context, the
 * credential its method extracted, a `deny` helper, and the matched route's
 * required scopes, and returns that identity's {@link GuardSuccess} or a
 * `deny(...)` result. Keying by name lets each guard's return be typed against
 * its own identity, so access values narrow without an annotation.
 */
export type GuardFnsFor<Schemes extends Record<string, SecurityScheme>, Params, HandlerContext> = {
    [Name in keyof Schemes]: (
        args: HandlerContext &
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
export type GuardsFor<Schemes extends Record<string, SecurityScheme>, HandlerContext> = {
    [Name in keyof Schemes]: GuardRun<HandlerContext>;
};

/**
 * The resolver functions for the request context schemas declared on `kizuna`,
 * keyed by name. Each runs on every route and returns its schema's value.
 */
export type RequestResolverFnsFor<RequestContext extends Record<string, RequestContextSchema>, HandlerContext> = {
    [Name in keyof RequestContext]: (
        args: HandlerContext & {
            params: Record<string, string>;
            headers: RequestContextHeaderValues<RequestContext[Name]>;
        }
    ) => z.output<RequestContext[Name]['context']> | Promise<z.output<RequestContext[Name]['context']>>;
};

/**
 * The serving counterpart to a contract, shared by every adapter. An adapter
 * fixes `HandlerContext` to what its handlers receive and `Api` to its own api
 * type, and adds nothing else.
 *
 * @example
 * export interface Server<C extends Contract> extends CoreServer<C, ExpressHandlerContext, ExpressApi<RoutesOf<C>>> {}
 */
export interface Server<C extends Contract, HandlerContext, Api> {
    /**
     * Define a guard for one of the contract's identities. It runs before the
     * handlers of every route whose `auth` entry requires the identity, and
     * receives the credential its method extracted (`bearer`, `apiKey`, or
     * `basic`, `null` when absent). Return the identity's context and access
     * fields to allow the request, or call `deny(status, detail)`.
     */
    guard<const Name extends Extract<keyof SchemesOf<C>, string>>(
        name: Name,
        run: GuardFnsFor<SchemesOf<C>, GuardParams<RoutesOf<C>, AuthOf<C>, Name>, HandlerContext>[Name]
    ): GuardRun<HandlerContext>;
    /**
     * Define a request context resolver declared on the contract. It runs on
     * every route, public ones included, and never denies.
     */
    requestContext<const Name extends Extract<keyof RequestContextOf<C>, string>>(
        name: Name,
        run: RequestResolverFnsFor<RequestContextOf<C>, HandlerContext>[Name]
    ): RequestContextRun<HandlerContext>;
    /**
     * Write typed handlers for the contract or one of its route groups.
     */
    router: {
        <const GroupOrRoutes extends Extract<keyof ContractRouter<C, HandlerContext>, string> | Routes>(
            group: GroupOrRoutes,
            router: ContractGroupRouter<C, GroupOrRoutes, HandlerContext>
        ): ContractGroupRouter<C, GroupOrRoutes, HandlerContext>;
        (router: ContractRouter<C, HandlerContext>): ContractRouter<C, HandlerContext>;
    };
    /**
     * Write a handler for each of the contract's jobs.
     *
     * Pass a `transport` to say where a queued job goes. Without one, `queue`
     * runs the job in this process and it is lost on a crash.
     *
     * @example
     * export const jobs = server.jobs({
     *     sendDigests: async () => ({
     *         status: 200,
     *         body: {
     *             sent: await sendPendingDigests(),
     *         },
     *     }),
     * });
     */
    jobs(handlers: ContractJobsRouter<C>): ContractJobsRouter<C>;
    /**
     * Implement one of the contract's receivers. The first argument names the
     * contract entry, which is what types `body`.
     *
     * @example
     * export const payments = server.receiver('payments', {
     *     verify: verifyPayments,
     *     handler: async ({ body }) => {
     *         await recordPayment(body.id);
     *     },
     * });
     */
    receiver: {
        <const Name extends Extract<keyof ReceiversOf<C>, string>>(
            name: Name,
            implementation: ReceiverImplementation<ReceiversOf<C>[Name], JobsOf<C>>
        ): ReceiverImplementation<ReceiversOf<C>[Name], JobsOf<C>>;
        /**
         * Type a verifier written in its own file.
         *
         * @example
         * export const verifyPayments = server.receiver.verify('payments', ({ raw, headers, deny }) => {
         *     if (!isDigestValid(raw, headers['x-signature'])) {
         *         deny();
         *     }
         * });
         */
        verify<const Name extends Extract<keyof ReceiversOf<C>, string>>(name: Name, run: ReceiverVerify): ReceiverVerify;
    };
    /**
     * Assemble the router, guards, job handlers, and receivers into the api
     * object.
     */
    api(options: ServerApiOptions<C, HandlerContext>): Api;
}

/**
 * What `server.api` takes. Each part is required exactly when the contract
 * declares something for it.
 */
export type ServerApiOptions<C extends Contract, HandlerContext> = {
    router: ContractRouter<C, HandlerContext>;
} & (string extends keyof SchemesOf<C> ? { guards?: undefined } : { guards: NoInfer<GuardsFor<SchemesOf<C>, HandlerContext>> }) &
    (string extends keyof JobsOf<C> ? { jobs?: undefined } : { jobs: NoInfer<ContractJobsRouter<C>> }) &
    (string extends keyof RequestContextOf<C>
        ? { requestContext?: undefined }
        : { requestContext: NoInfer<{ [Name in keyof RequestContextOf<C>]: RequestContextRun<HandlerContext> }> }) &
    (string extends keyof ReceiversOf<C>
        ? { receivers?: undefined }
        : { receivers: NoInfer<ReceiverImplementations<ReceiversOf<C>, JobsOf<C>>> }) &
    (string extends keyof ContractPluginsOf<C>
        ? { plugins?: undefined }
        : { plugins: PluginImplementations<ContractPluginsOf<C>, HandlerContext> });

/**
 * Build the server surface for one adapter. `finish` receives the assembled api
 * and returns the adapter's own, which is where `mount` is attached.
 */
export const createServerSurface = <C extends Contract, HandlerContext, Api>(
    contract: C,
    options: ServerOptions | undefined,
    finish: (api: ApiWithRouter, extras: Record<string, unknown>) => Api
): Server<C, HandlerContext, Api> => {
    warnUnsupportedJobOptions(contract.jobs, options?.jobTransport);
    const server = {
        guard: (_name: string, run: unknown) => run,
        requestContext: (_name: string, run: unknown) => run,
        router: (groupOrRouter: unknown, groupRouter?: unknown) => groupRouter ?? groupOrRouter,
        jobs: (handlers: unknown) => handlers,
        receiver: Object.assign((_name: string, implementation: unknown) => implementation, {
            verify: (_name: string, run: unknown) => run,
        }),
        api: (options_: Record<string, unknown>) => {
            // Anything beyond the shared parts belongs to the adapter, which reads it in `finish`.
            const { router, guards, requestContext, plugins, jobs, receivers, ...extras } = options_;
            const parts = {
                router,
                guards,
                requestContext,
                plugins,
            } as ApiParts;
            if (contract.receivers) {
                warnUnimplementedReceivers(contract.receivers, (receivers ?? {}) as ReceiversMeta['implementations']);
            }
            return finish(
                Object.assign(assembleApi(contract, parts), {
                    [JOBS_META]: contract.jobs
                        ? {
                              jobs: contract.jobs,
                              handlers: (jobs ?? {}) as Record<string, unknown>,
                              config: contract.jobsConfig,
                              transport: options?.jobTransport,
                              onError: options?.onJobError,
                          }
                        : undefined,
                    [RECEIVERS_META]: contract.receivers
                        ? {
                              receivers: contract.receivers,
                              implementations: (receivers ?? {}) as ReceiversMeta['implementations'],
                              onError: options?.onReceiverError,
                          }
                        : undefined,
                }),
                extras
            );
        },
    };
    return server as unknown as Server<C, HandlerContext, Api>;
};
