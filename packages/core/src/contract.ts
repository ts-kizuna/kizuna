import type { Routes } from './types.js';
import type { TagSet, TagOptions } from './tags.js';
import type { SecurityScheme } from './security-scheme.js';
import type { RequestContextSchema } from './request-context.js';
import type { Jobs, JobsConfig } from './jobs.js';
import type { ContractPlugins } from './plugin.js';
import type { Permission } from './permission.js';
import type { PermissionsConfig } from './permissions-endpoint.js';

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
    Permissions_ extends Record<string, Permission> = Record<string, Permission>,
    Permissions = unknown,
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
     * The `auth` map passed to `k.contract`, keyed by route group. Carried on the
     * contract so the adapters can resolve each route's required identities and
     * access constraints into the handler's scheme-keyed context.
     */
    auth?: Auth;
    /**
     * The `permissions` map passed to `k.contract`, keyed by route group. Carried
     * on the contract so the adapters can resolve each route's requirement, and so
     * a report can list what every route demands.
     */
    permissions?: Permissions;
    /**
     * The permissions passed to `new Kizuna()`. The `permissions` map references
     * them by name, and `server.api` requires one implementation each.
     */
    declaredPermissions?: Permissions_;
    /**
     * The permissions-endpoint settings passed to `new Kizuna()` under
     * `permissions`.
     */
    permissionsConfig?: PermissionsConfig;
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
    const Permissions_ extends Record<string, Permission> = Record<string, never>,
    const Permissions = unknown,
>(config: {
    routes: R;
    jobs?: Jobs_;
    jobsConfig?: JobsConfig;
    auth?: Auth;
    permissions?: Permissions;
    declaredPermissions?: Permissions_;
    permissionsConfig?: PermissionsConfig;
    tags?: TagSet<Tags>;
    securitySchemes?: Schemes;
    requestContext?: RequestContext;
    validation?: {
        issueCodes?: readonly Codes[];
    };
    plugins?: Plugins;
}): Contract<R, Tags, Codes, Schemes, Auth, RequestContext, Plugins, Jobs_, Permissions_, Permissions> {
    return {
        routes: config.routes,
        plugins: config.plugins,
        jobs: config.jobs,
        jobsConfig: config.jobsConfig,
        auth: config.auth,
        permissions: config.permissions,
        declaredPermissions: config.declaredPermissions,
        permissionsConfig: config.permissionsConfig,
        tags: config.tags,
        securitySchemes: config.securitySchemes,
        requestContext: config.requestContext,
        validation: config.validation,
    };
}
