import type { Routes } from './types.js';
import type { TagSet, TagOptions } from './tags.js';
import type { SecurityScheme } from './security-scheme.js';
import type { RequestContextSchema } from './request-context.js';
import type { Jobs, JobsConfig } from './jobs.js';
import type { Receivers } from './receivers.js';
import type { ContractPlugins } from './plugin.js';

/**
 * A kizuna API definition: its routes plus tags, identities, and validation
 * settings. Produced by `k.contract` and consumed by the server adapters,
 * fetch client, OpenAPI generator, and SDK generators.
 */
export interface Contract<
    Routes_ extends Routes = Routes,
    Tags extends Record<string, TagOptions> = Record<string, TagOptions>,
    Codes extends string = string,
    Schemes extends Record<string, SecurityScheme> = Record<string, SecurityScheme>,
    Auth = unknown,
    RequestContext extends Record<string, RequestContextSchema> = Record<string, RequestContextSchema>,
    Plugins extends ContractPlugins = ContractPlugins,
    Jobs_ extends Jobs = Jobs,
    Receivers_ extends Receivers = Receivers,
> {
    /**
     * The API's route groups.
     */
    routes: Routes_;
    /**
     * The plugins passed to `new Kizuna()`. Their routes are served by
     * `api.mount` but stay outside `routes`, so the client and the generators
     * do not see them.
     */
    plugins?: Plugins;
    /**
     * The scheduled jobs declared with `k.jobs`, keyed by name.
     */
    jobs?: Jobs_;
    /**
     * The job settings passed to `new Kizuna()` under `jobs`.
     */
    jobsConfig?: JobsConfig;
    /**
     * The incoming webhooks declared with `k.receiver`, keyed by vendor. Served
     * by `api.mount` but outside `routes`, so the client and the generators do
     * not see them.
     */
    receivers?: Receivers_;
    /**
     * The `auth` map passed to `k.contract`, keyed by route group. Carried on the
     * contract so the adapters can resolve each route's required identities and
     * access constraints into the handler's scheme-keyed context.
     */
    auth?: Auth;
    /**
     * The tag set declared with `Kizuna.tags`. Routes reference its keys; the
     * OpenAPI generator resolves each key to its title and description.
     */
    tags?: TagSet<Tags>;
    /**
     * The identities passed to `new Kizuna()`. Routes reference them by name in
     * their `security` field; the OpenAPI generator emits them under
     * `components.securitySchemes`.
     */
    securitySchemes?: Schemes;
    /**
     * The request context schemas passed to `new Kizuna()`. Each key names a
     * provider registered on `server.api`; every handler receives its value.
     * Never gates a request and never appears in the OpenAPI document.
     */
    requestContext?: RequestContext;
    /**
     * Validation behavior for the API.
     */
    validation?: {
        /**
         * Custom validation issue codes this API's handlers may emit.
         */
        issueCodes?: readonly Codes[];
    };
}

/**
 * Internal helper that builds a {@link Contract} from routes, tags, identities,
 * and issue codes. Called by `k.contract`. Not part of the public surface;
 * author contracts through `k`.
 */
export function assembleContract<
    const Tags extends Record<string, TagOptions> = Record<string, never>,
    const Codes extends string = never,
    const Schemes extends Record<string, SecurityScheme> = Record<string, never>,
    const R extends Routes<Extract<keyof Tags, string>, Extract<keyof Schemes, string>> = Routes<
        Extract<keyof Tags, string>,
        Extract<keyof Schemes, string>
    >,
    const Auth = unknown,
    const RequestContext extends Record<string, RequestContextSchema> = Record<string, never>,
    const Plugins extends ContractPlugins = Record<string, never>,
    const Jobs_ extends Jobs = Record<string, never>,
    const Receivers_ extends Receivers = Record<string, never>,
>(config: {
    routes: R;
    jobs?: Jobs_;
    jobsConfig?: JobsConfig;
    receivers?: Receivers_;
    auth?: Auth;
    tags?: TagSet<Tags>;
    securitySchemes?: Schemes;
    requestContext?: RequestContext;
    validation?: {
        issueCodes?: readonly Codes[];
    };
    plugins?: Plugins;
}): Contract<R, Tags, Codes, Schemes, Auth, RequestContext, Plugins, Jobs_, Receivers_> {
    return {
        routes: config.routes,
        plugins: config.plugins,
        jobs: config.jobs,
        jobsConfig: config.jobsConfig,
        receivers: config.receivers,
        auth: config.auth,
        tags: config.tags,
        securitySchemes: config.securitySchemes,
        requestContext: config.requestContext,
        validation: config.validation,
    };
}

/**
 * A contract's route groups.
 */
export type RoutesOf<C extends Contract> = C['routes'];

/**
 * A contract's identities, or an empty map when it declares none.
 */
export type SchemesOf<C extends Contract> = Exclude<C['securitySchemes'], undefined>;

/**
 * The `auth` map a contract was built with.
 */
export type AuthOf<C extends Contract> = Exclude<C['auth'], undefined>;

/**
 * A contract's request context schemas, or an empty map when it declares none.
 */
export type RequestContextOf<C extends Contract> = Exclude<C['requestContext'], undefined>;

/**
 * A contract's plugins, or an empty map when it declares none.
 */
export type ContractPluginsOf<C extends Contract> = Exclude<C['plugins'], undefined>;

/**
 * A contract's jobs, or an empty map when it declares none.
 */
export type JobsOf<C extends Contract> = Exclude<C['jobs'], undefined>;

/**
 * A contract's receivers, or an empty map when it declares none.
 */
export type ReceiversOf<C extends Contract> = Exclude<C['receivers'], undefined>;
