import type { Routes } from './types.js';
import type { GroupSet, GroupOptions, GroupPaths } from './groups.js';
import type { SecurityScheme } from './security-scheme.js';
import type { RequestContextSchema } from './request-context.js';
import type { Jobs, JobsConfig } from './jobs.js';
import type { ContractPlugins } from './plugin.js';

/**
 * A kizuna API definition: its routes plus tags, identities, and validation
 * settings. Produced by `k.contract` and consumed by the server adapters,
 * fetch client, OpenAPI generator, and SDK generators.
 */
export interface Contract<
    Routes_ extends Routes = Routes,
    Groups extends Record<string, GroupOptions | string> = Record<string, GroupOptions | string>,
    Codes extends string = string,
    Schemes extends Record<string, SecurityScheme> = Record<string, SecurityScheme>,
    Auth = unknown,
    RequestContext extends Record<string, RequestContextSchema> = Record<string, RequestContextSchema>,
    Plugins extends ContractPlugins = ContractPlugins,
    Jobs_ extends Jobs = Jobs,
> {
    /**
     * The API's route groups.
     */
    routes: Routes_;
    /**
     * The plugins installed on `k.contract`. Their routes are served by
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
     * The `auth` map passed to `k.contract`, keyed by route group. Carried on the
     * contract so the adapters can resolve each route's required identities and
     * access constraints into the handler's scheme-keyed context.
     */
    auth?: Auth;
    /**
     * The group set declared with `Kizuna.groups`.
     */
    groups?: GroupSet<Groups>;
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
    const Groups extends Record<string, GroupOptions | string> = Record<string, never>,
    const Codes extends string = never,
    const Schemes extends Record<string, SecurityScheme> = Record<string, never>,
    const R extends Routes<Extract<GroupPaths<Groups>, string>, Extract<keyof Schemes, string>> = Routes<
        Extract<GroupPaths<Groups>, string>,
        Extract<keyof Schemes, string>
    >,
    const Auth = unknown,
    const RequestContext extends Record<string, RequestContextSchema> = Record<string, never>,
    const Plugins extends ContractPlugins = Record<string, never>,
    const Jobs_ extends Jobs = Record<string, never>,
>(config: {
    routes: R;
    jobs?: Jobs_;
    jobsConfig?: JobsConfig;
    auth?: Auth;
    groups?: GroupSet<Groups>;
    securitySchemes?: Schemes;
    requestContext?: RequestContext;
    validation?: {
        issueCodes?: readonly Codes[];
    };
    plugins?: Plugins;
}): Contract<R, Groups, Codes, Schemes, Auth, RequestContext, Plugins, Jobs_> {
    return {
        routes: config.routes,
        plugins: config.plugins,
        jobs: config.jobs,
        jobsConfig: config.jobsConfig,
        auth: config.auth,
        groups: config.groups,
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
