import type { z } from 'zod';
import type { Routes } from './types.js';
import type { TagSet, TagOptions } from './tags.js';
import type { SecurityScheme } from './security-scheme.js';
import type { RequestContextSchema } from './request-context.js';
import type { Jobs, JobsConfig } from './jobs.js';
import type { Tools } from './tools.js';
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
    AccessControl = unknown,
    RequestContext extends Record<string, RequestContextSchema> = Record<string, RequestContextSchema>,
    Plugins extends ContractPlugins = ContractPlugins,
    Jobs_ extends Jobs = Jobs,
    Tools_ extends Tools = Tools,
    GuardSchema extends z.ZodType | undefined = z.ZodType | undefined,
    ToolAccessControl extends Record<string, unknown> = Record<string, unknown>,
> {
    /**
     * The API's route groups.
     */
    routes: Routes_;
    /**
     * The body every guard's `deny()` produces, passed to `new Kizuna()` under
     * `guardSchema`. Each guarded route's `401` and `403` carry it in place of
     * bare Problem Details.
     */
    guardSchema?: GuardSchema;
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
     * The tools declared with `k.tools`, keyed by name. A model calls them;
     * they are never routes, so nothing that walks `routes` sees them.
     */
    tools?: Tools_;
    /**
     * The tool access control map passed to `k.contract`, nested the way the
     * tool tree is. Carried so the server surface can type each handler's
     * `auth`.
     */
    toolAccessControl?: ToolAccessControl;
    /**
     * The access control map passed to `k.contract`, keyed by route group. Carried on
     * the contract so the adapters can resolve each route's required identities
     * and permissions into the handler's scheme-keyed context.
     */
    accessControl?: AccessControl;
    /**
     * The tag set declared with `Kizuna.tags`. Routes reference its keys; the
     * OpenAPI generator resolves each key to its title and description.
     */
    tags?: TagSet<Tags>;
    /**
     * The identities passed to `new Kizuna()`. The access control map references
     * them by name, `k.contract` writes each route's `security` from it, and the
     * OpenAPI generator emits them under `components.securitySchemes`.
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
    const AccessControl = unknown,
    const RequestContext extends Record<string, RequestContextSchema> = Record<string, never>,
    const Plugins extends ContractPlugins = Record<string, never>,
    const Jobs_ extends Jobs = Record<string, never>,
    const Tools_ extends Tools = Record<string, never>,
    GuardSchema extends z.ZodType | undefined = undefined,
    const ToolAccessControl extends Record<string, unknown> = Record<string, never>,
>(config: {
    routes: R;
    guardSchema?: GuardSchema;
    jobs?: Jobs_;
    jobsConfig?: JobsConfig;
    tools?: Tools_;
    toolAccessControl?: ToolAccessControl;
    accessControl?: AccessControl;
    tags?: TagSet<Tags>;
    securitySchemes?: Schemes;
    requestContext?: RequestContext;
    validation?: {
        issueCodes?: readonly Codes[];
    };
    plugins?: Plugins;
}): Contract<R, Tags, Codes, Schemes, AccessControl, RequestContext, Plugins, Jobs_, Tools_, GuardSchema, ToolAccessControl> {
    return {
        routes: config.routes,
        guardSchema: config.guardSchema,
        plugins: config.plugins,
        jobs: config.jobs,
        jobsConfig: config.jobsConfig,
        tools: config.tools,
        toolAccessControl: config.toolAccessControl,
        accessControl: config.accessControl,
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
 * The access control map a contract was built with.
 */
export type AccessControlOf<C extends Contract> = Exclude<C['accessControl'], undefined>;

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

export type GuardSchemaOf<C extends Contract> = Extract<C['guardSchema'], z.ZodType>;

/**
 * A contract's tools, or an empty map when it declares none.
 */
export type ToolsOf<C extends Contract> = Exclude<C['tools'], undefined>;

/**
 * The tool access control map a contract was assembled with.
 */
export type ToolAccessControlOf<C extends Contract> = Exclude<C['toolAccessControl'], undefined>;
