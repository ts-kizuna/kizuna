import type { z } from 'zod';
import { tagRoutes } from './routes.js';
import { assembleContract, type Contract } from './contract.js';
import { pluginRouteTree, type ContractPlugins, type ContractPluginsArg, type PluginArgs } from './plugin.js';
import { assertNoPathCollisions, routeClaims } from './path-claims.js';
import { flattenRoutes } from './handler-pipeline.js';
import { assertValidDeprecationDates } from './deprecation.js';
import { assertValidCache } from './cache.js';
import { injectGuardResponses } from './guard-responses.js';
import { addCodedIssue, type RegisteredIssue } from './coded-issue.js';
import { isRouteDefinition, type RoutesWithHandlerContext } from './handler-pipeline.js';
import { jobClaims, buildJobs, type AuthoredJobs, type CompiledJobs, type Jobs, type JobsArg, type JobsConfig } from './jobs.js';
import {
    attachRouteKeys,
    isCompiledTool,
    buildTools,
    resolveAuthoredTools,
    type AuthoredToolsArg,
    type AuthoredTools,
    type CompiledTools,
    type Tools,
} from './tools.js';
import type { ToolsArg } from './tool-runner.js';
import { createTags, type TagSet, type TagOptions } from './tags.js';
import { createIdentity, type RolesOf } from './identity.js';
import { createPermissions, createRoles, permissionNames, type CatalogOf, type PermissionSet, type RoleNamesOf } from './permissions.js';
import { createRequestContext } from './request-context.js';
import { createModel } from './model.js';
import { problemDetails, type GuardBody, type GuardOutput, type GuardSchemaCheck } from './problem-details.js';
import { readObjectShape } from './zod-internals.js';
import type { Routes, RouteDefinition, SecurityRequirement, RequiredPermissions, AuthoredRoutes } from './types.js';
import type { SecurityScheme } from './security-scheme.js';
import type { RequestContextSchema } from './request-context.js';
import type { PathParamsCheck } from './path-params.js';

/**
 * One entry in the access control map: `false` for public, an identity name,
 * or `{ auth, roles?, requires? }`.
 */
export type AccessControlValue<Id extends string = string, Identities = Record<string, unknown>> =
    | Id
    | false
    | AccessControlRule<Id, Identities>;

/**
 * The access control map for a contract's tools, nested the way the tool tree
 * is. A tool naming a route with `toolFromRoutes` has no entry: that route's
 * access control governs it.
 */
export type ToolAccessControlMap<Id extends string = string, T extends Tools = Tools, Identities = Record<string, unknown>> = {
    [Name in keyof T & string]?: T[Name] extends {
        route: unknown;
    }
        ? never
        : T[Name] extends {
                definition: unknown;
            }
          ? AccessControlValue<Id, Identities>
          : T[Name] extends Tools
            ? ToolAccessControlMap<Id, T[Name], Identities>
            : never;
};

/**
 * The `requires` an identity accepts: a subset of the catalog behind its roles,
 * or `never` when the identity declares no roles.
 */
type RequiresOf<Identities, Name extends string> = Name extends keyof Identities
    ? [CatalogOf<RolesOf<Identities[Name]>>] extends [never]
        ? never
        : PermissionSet<CatalogOf<RolesOf<Identities[Name]>>>
    : never;

/**
 * The `roles` an identity accepts: one of its declared role names or several,
 * or `never` when the identity declares no roles.
 */
type AcceptedRolesOf<Identities, Name extends string> = Name extends keyof Identities
    ? [RoleNamesOf<RolesOf<Identities[Name]>>] extends [never]
        ? never
        : RoleNamesOf<RolesOf<Identities[Name]>> | readonly RoleNamesOf<RolesOf<Identities[Name]>>[]
    : never;

/**
 * The object form of an {@link AccessControlValue}.
 */
export type AccessControlRule<Id extends string = string, Identities = Record<string, unknown>> =
    | {
          [Name in Id]: {
              auth: Name;
              roles?: AcceptedRolesOf<Identities, Name>;
              requires?: RequiresOf<Identities, Name>;
          };
      }[Id]
    | {
          auth: readonly Id[];
          roles?: AcceptedRolesOf<Identities, Id>;
          requires?: RequiresOf<Identities, Id>;
      };

/**
 * A group's entry in the access control map: one {@link AccessControlValue} for the whole
 * group, or a cascade `{ '*': default, key: override }` whose named keys are the
 * group's own routes and subgroups, an {@link AccessControlValue}, or a nested cascade
 * (an object with its own `'*'`) for a subgroup.
 */
export type GroupAccessControl<
    Id extends string = string,
    Group = Routes,
    Identities = Record<string, unknown>,
> = Group extends RouteDefinition
    ? AccessControlValue<Id, Identities>
    : AccessControlValue<Id, Identities> | GroupAccessControlCascade<Id, Group, Identities>;

/**
 * The cascade form of {@link GroupAccessControl} when the group's shape isn't statically
 * known.
 */
interface LooseGroupAccessControlCascade<Id extends string = string, Identities = Record<string, unknown>> {
    '*': AccessControlValue<Id, Identities>;
    [key: string]: AccessControlValue<Id, Identities> | LooseGroupAccessControlCascade<Id, Identities>;
}

/**
 * The cascade form of {@link GroupAccessControl}.
 */
export type GroupAccessControlCascade<
    Id extends string = string,
    Group = Routes,
    Identities = Record<string, unknown>,
> = string extends keyof Group
    ? LooseGroupAccessControlCascade<Id, Identities>
    : {
          '*': AccessControlValue<Id, Identities>;
      } & {
          [Key in keyof Group & string]?: GroupAccessControl<Id, Group[Key], Identities>;
      };

/**
 * The access control map passed to `k.contract`: keyed by route group (every group must
 * appear), with values checked against the contract's identity names and the
 * permissions their roles declare. The second parameter takes the routes type,
 * or a union of group names for the unshaped form.
 */
export type AccessControlMap<Id extends string = string, GroupsOrRoutes = Record<string, Routes>, Identities = Record<string, unknown>> = [
    GroupsOrRoutes,
] extends [string]
    ? { [Group in GroupsOrRoutes]: GroupAccessControl<Id, Routes, Identities> }
    : { [Group in keyof GroupsOrRoutes & string]: GroupAccessControl<Id, GroupsOrRoutes[Group], Identities> };

/**
 * Rechecks an inferred access control map against the routes, erroring on keys that
 * plain assignability would let through as excess properties.
 */
export type ValidAccessControlMap<A, R, Id extends string, Identities = Record<string, unknown>> = {
    [Group in keyof A]: Group extends keyof R ? ValidGroupAccessControl<A[Group], R[Group], Id, Identities> : never;
};

type ValidGroupAccessControl<Entry, Group, Id extends string, Identities> = Group extends RouteDefinition
    ? Entry extends { '*': unknown }
        ? never
        : AccessControlValue<Id, Identities>
    : Entry extends { '*': unknown }
      ? {
            [Key in keyof Entry]: Key extends '*'
                ? AccessControlValue<Id, Identities>
                : Key extends keyof Group
                  ? ValidGroupAccessControl<Entry[Key], Group[Key], Id, Identities>
                  : never;
        }
      : AccessControlValue<Id, Identities>;

/**
 * Kizuna sends the guard body itself when a route's `requires` turns a caller
 * away, so every field beyond the envelope has to be one it can fill.
 */
const ENVELOPE_FIELDS = ['type', 'title', 'status', 'detail'];

const assertFillableGuardSchema = (schema: z.ZodType): void => {
    const shape = readObjectShape(schema);
    if (shape === undefined || !ENVELOPE_FIELDS.every((field) => field in shape)) {
        throw new Error(
            'The `guardSchema` must extend `ProblemDetailsSchema`. Every response at 400 or above is RFC 9457 Problem Details.'
        );
    }
    if (schema.safeParse(problemDetails(403, 'Forbidden')).success) return;
    throw new Error(
        'The `guardSchema` cannot be built from a status and a detail alone. ' +
            "Kizuna sends it when a route's `requires` refuses a caller, so give every field you added `.optional()` or a `.default()`."
    );
};

/**
 * Apply one {@link AccessControlValue} to a single route, setting its `security` and,
 * when narrowed, its `roles` and `requires`.
 */
const resolveAccessControlValue = (
    route: RouteDefinition,
    value: AccessControlValue,
    identities: Record<string, SecurityScheme> | undefined,
    routePath: string
): void => {
    delete route.roles;
    delete route.requires;
    if (value === false) {
        route.security = [];
        return;
    }
    if (typeof value === 'string') {
        route.security = [value];
        return;
    }
    const names = typeof value.auth === 'string' ? [value.auth] : [...value.auth];
    if (names.length === 0) {
        throw new Error(`Access control entry for '${routePath}' names no identity under \`auth\`.`);
    }
    route.security = [requirementFor(names, undefined, identities) as SecurityRequirement];

    const accepted = value.roles === undefined ? [] : typeof value.roles === 'string' ? [value.roles] : [...value.roles];
    if (accepted.length > 0) {
        const declared = names.map((name) => identities?.[name]?.roles).filter((roles) => roles !== undefined);
        if (declared.length === 0) {
            throw new Error(`Access control entry for '${routePath}' has \`roles\`, but none of its identities declares roles.`);
        }
        for (const role of accepted) {
            if (!declared.some((roles) => roles.names.includes(role))) {
                throw new Error(
                    `Access control entry for '${routePath}' accepts the role '${role}', which no identity on the route declares.`
                );
            }
        }
        route.roles = accepted;
    }

    const requires = value.requires as RequiredPermissions | undefined;
    if (requires === undefined || Object.keys(requires).length === 0) return;
    const catalogs = names.map((name) => identities?.[name]?.roles?.permissions?.catalog).filter((catalog) => catalog !== undefined);
    if (catalogs.length === 0) {
        throw new Error(`Access control entry for '${routePath}' has \`requires\`, but none of its identities declares permissions.`);
    }
    for (const [resource, verbs] of Object.entries(requires)) {
        for (const verb of verbs) {
            if (!catalogs.some((catalog) => catalog[resource]?.includes(verb))) {
                throw new Error(
                    `Access control entry for '${routePath}' requires '${resource}:${verb}', which no identity on the route declares.`
                );
            }
        }
    }
    route.requires = requires;
    route.security = [requirementFor(names, requires, identities) as SecurityRequirement];
};

/**
 * Write a tool access control map onto the tools it names. A tool running a
 * route is refused an entry: that route already says who may call it.
 */
const applyToolAccessControl = (
    tools: Tools,
    map: Record<string, unknown>,
    identities: Record<string, SecurityScheme> | undefined,
    path = ''
): void => {
    for (const [name, value] of Object.entries(map)) {
        const toolKey = path ? `${path}.${name}` : name;
        const node = tools[name];
        if (node === undefined) {
            throw new Error(`Tool access control map names "${toolKey}", which this contract does not declare.`);
        }
        if (isCompiledTool(node)) {
            if (node.route !== undefined) {
                throw new Error(
                    `Tool "${toolKey}" runs a route, so the route's own entry in the access control map says who may call it. Remove this one.`
                );
            }
            const entry = node as unknown as RouteDefinition;
            resolveAccessControlValue(entry, value as AccessControlValue, identities, toolKey);
            const mutable = node as { identity: string | undefined };
            const requirement = entry.security?.[0];
            mutable.identity = typeof requirement === 'string' ? requirement : requirement && Object.keys(requirement)[0];
            continue;
        }
        applyToolAccessControl(node as Tools, value as Record<string, unknown>, identities, toolKey);
    }
};

/**
 * The security requirement for the identities an entry names. An OAuth token
 * carries its permissions as scopes, so an `oauth2` or `openIdConnect`
 * identity lists what the route requires from its catalog.
 */
const requirementFor = (
    names: readonly string[],
    requires: RequiredPermissions | undefined,
    identities: Record<string, SecurityScheme> | undefined
): Record<string, readonly string[]> => {
    const requirement: Record<string, readonly string[]> = {};
    for (const name of names) {
        const identity = identities?.[name];
        const type = identity?.openapi?.type;
        const catalog = identity?.roles?.permissions?.catalog;
        requirement[name] =
            requires !== undefined && catalog !== undefined && (type === 'oauth2' || type === 'openIdConnect')
                ? permissionNames(requires).filter((permission) => {
                      const [resource, verb] = permission.split(':');
                      return catalog[resource ?? '']?.includes(verb ?? '') ?? false;
                  })
                : [];
    }
    return requirement;
};

const hasCascade = (value: unknown): value is { '*': AccessControlValue } & Record<string, AccessControlValue | GroupAccessControl> =>
    typeof value === 'object' && value !== null && !Array.isArray(value) && '*' in value;

/**
 * Resolve a group's {@link GroupAccessControl} across its subtree. Cascade keys address
 * the group's own routes and subgroups, and a named key replaces the `'*'`
 * default for what it names; a key matching none would be a silent no-op, so it
 * throws instead.
 */
const applyGroupAccessControl = (
    group: Routes,
    groupAccess: GroupAccessControl,
    path: string,
    identities: Record<string, SecurityScheme> | undefined
): void => {
    const cascade = hasCascade(groupAccess);
    const groupDefault = (cascade ? groupAccess['*'] : groupAccess) as AccessControlValue;
    if (cascade) {
        for (const overrideKey of Object.keys(groupAccess)) {
            if (overrideKey !== '*' && !(overrideKey in group)) {
                throw new Error(`Access control map key '${overrideKey}' does not match a route or group directly under '${path}'.`);
            }
        }
    }
    for (const [key, value] of Object.entries(group)) {
        const entry = cascade ? (groupAccess as Record<string, GroupAccessControl | undefined>)[key] : undefined;
        const subPath = `${path}.${key}`;
        if (!isRouteDefinition(value)) {
            applyGroupAccessControl(value as Routes, entry === undefined ? groupDefault : entry, subPath, identities);
            continue;
        }
        if (hasCascade(entry)) {
            throw new Error(`Access control map key '${key}' under '${path}' targets a route; a nested cascade only applies to a group.`);
        }
        resolveAccessControlValue(
            value as RouteDefinition,
            (entry === undefined ? groupDefault : entry) as AccessControlValue,
            identities,
            subPath
        );
    }
};

/**
 * What a {@link Kizuna} instance declares.
 */
export interface KizunaSpec {
    tags: Record<string, TagOptions>;
    codes: string;
    identities: Record<string, SecurityScheme>;
    requestContext: Record<string, RequestContextSchema>;
    guardSchema: z.ZodType | undefined;
}

/**
 * The tag names declared on a spec, e.g. `'health' | 'users'`.
 */
export type TagNamesOf<Spec extends KizunaSpec> = Extract<keyof Spec['tags'], string>;

/**
 * The identity names declared on a spec, e.g. `'user' | 'member'`.
 */
export type IdentityNamesOf<Spec extends KizunaSpec> = Extract<keyof Spec['identities'], string>;

/**
 * The authoring surface a {@link Kizuna} instance exposes.
 */
export interface K<Spec extends KizunaSpec = KizunaSpec> {
    /**
     * Define a group of routes. Pass a tag (one of the keys from `Kizuna.tags`)
     * to group them in the OpenAPI document, or omit it for an untagged group.
     */
    routes<const T extends AuthoredRoutes<TagNamesOf<Spec>>>(tag: TagNamesOf<Spec>, defs: T & PathParamsCheck<T>): T;
    routes<const T extends AuthoredRoutes>(defs: T & PathParamsCheck<T>): T;
    /**
     * The access control map, typed against the routes, the identities and the
     * permissions their roles declare. Define it beside the routes, then pass
     * it to `k.contract` under `accessControl`.
     *
     * @example
     * export const accessControl = k.accessControl(routes, {
     *     health: false,
     *     users: 'user',
     *     workspace: {
     *         '*': 'member',
     *         deleteWorkspace: {
     *             auth: 'member',
     *             requires: {
     *                 workspace: ['delete'],
     *             },
     *         },
     *     },
     * });
     */
    accessControl: {
        <
            const R extends Routes<TagNamesOf<Spec>, IdentityNamesOf<Spec>>,
            const A extends AccessControlMap<IdentityNamesOf<Spec>, R, Spec['identities']>,
        >(
            routes: R,
            map: A & ValidAccessControlMap<A, R, IdentityNamesOf<Spec>, Spec['identities']>
        ): A;
        /**
         * The access control map for the contract's tools, typed against them.
         * Keep it beside `k.accessControl`, then pass it to `k.contract` under
         * `toolAccessControl`.
         *
         * A tool naming a route with `toolFromRoutes` has no entry.
         *
         * @example
         * export const toolAccessControl = k.accessControl.tools(tools, {
         *     purgeCache: {
         *         auth: 'member',
         *         roles: 'owner',
         *     },
         * });
         */
        tools<const T extends Tools, const A extends ToolAccessControlMap<IdentityNamesOf<Spec>, T, Spec['identities']>>(
            tools: T,
            map: A
        ): A;
    };
    /**
     * Declare scheduled jobs. Pass the identity every job requires, the one
     * credential your scheduler sends, then the jobs themselves.
     *
     * Jobs are their own concept, not routes. Each is reachable over HTTP so a
     * scheduler can trigger it, and runs through the same validation, guards, and
     * Problem Details as a route; but jobs never appear in `contract.routes`, the
     * OpenAPI document, or the generated Swift, Kotlin, and MCP surfaces.
     *
     * @example
     * export const jobs = k.jobs('scheduler', {
     *     sendDigests: {
     *         schedule: '0 5 * * *',
     *         summary: 'Send daily digest emails',
     *         result: z.object({
     *             sent: z.int(),
     *         }),
     *     },
     * });
     */
    jobs<const J extends AuthoredJobs, const Name extends IdentityNamesOf<Spec>>(identity: Name, definitions: J): CompiledJobs<J, Name>;
    jobs<const J extends AuthoredJobs>(definitions: J): CompiledJobs<J, undefined>;
    /**
     * Declare tools a model may call. A tool declares no path and no method, and
     * never appears in `contract.routes`, the OpenAPI document, or the generated
     * Swift and Kotlin clients. A streamed response names them under `tools`,
     * and the MCP plugin publishes them.
     *
     * Pass a function instead of an object to reach `toolFromRoutes`, which
     * names a route as a tool.
     *
     * @example
     * export const tools = k.tools({
     *     weather: {
     *         getForecast: {
     *             description: 'Look up tomorrow forecast for one city',
     *             input: z.object({
     *                 city: z.string(),
     *             }),
     *             output: z.object({
     *                 temperature: z.number(),
     *                 summary: z.string(),
     *             }),
     *         },
     *     },
     * });
     *
     * @example
     * export const tools = k.tools(({ toolFromRoutes }) => ({
     *     users: {
     *         find: toolFromRoutes(routes.users.getUser),
     *     },
     * }));
     */
    tools: {
        <const T extends AuthoredTools>(definitions: AuthoredToolsArg<T>): CompiledTools<T>;
    };
    /**
     * Assemble route groups into a contract. The access control map assigns each group
     * (and optionally each route, via a `'*'` cascade) the identity it requires,
     * and the roles it accepts or the permissions the caller has to hold;
     * `k.contract` resolves it onto every route's `security`, `roles` and `requires`.
     *
     * Jobs declared with `k.jobs` go under `jobs`, alongside `routes` rather than
     * inside it. They carry their own identity, so they never appear in the
     * access control map.
     */
    contract<
        const R extends Routes<TagNamesOf<Spec>, IdentityNamesOf<Spec>>,
        const A extends AccessControlMap<IdentityNamesOf<Spec>, R, Spec['identities']>,
        const J extends Jobs = Record<string, never>,
        const T extends Tools = Record<string, never>,
        const TA extends Record<string, unknown> = Record<string, never>,
        const P extends ContractPlugins = Record<string, never>,
    >(definition: {
        routes: R;
        jobs?: J;
        tools?: T;
        toolAccessControl?: TA & ToolAccessControlMap<IdentityNamesOf<Spec>, T, Spec['identities']>;
        plugins?: ContractPluginsArg<R, P, T>;
        accessControl: A & ValidAccessControlMap<A, R, IdentityNamesOf<Spec>, Spec['identities']>;
    }): Contract<
        RoutesWithHandlerContext<
            R,
            Spec['identities'],
            A,
            Spec['requestContext'],
            PluginArgs<P> & JobsArg<J> & ToolsArg<T>,
            GuardOutput<Spec['guardSchema']>,
            GuardBody<Spec['guardSchema']>
        >,
        Spec['tags'],
        Spec['codes'],
        Spec['identities'],
        A,
        Spec['requestContext'],
        P,
        J,
        T,
        Spec['guardSchema'],
        TA
    >;
    contract<
        const R extends Routes<TagNamesOf<Spec>, IdentityNamesOf<Spec>>,
        const J extends Jobs = Record<string, never>,
        const T extends Tools = Record<string, never>,
        const TA extends Record<string, unknown> = Record<string, never>,
        const P extends ContractPlugins = Record<string, never>,
    >(definition: {
        routes: R;
        jobs?: J;
        tools?: T;
        toolAccessControl?: TA & ToolAccessControlMap<IdentityNamesOf<Spec>, T, Spec['identities']>;
        plugins?: ContractPluginsArg<R, P, T>;
    }): Contract<
        RoutesWithHandlerContext<
            R,
            Spec['identities'],
            unknown,
            Spec['requestContext'],
            PluginArgs<P> & JobsArg<J> & ToolsArg<T>,
            GuardOutput<Spec['guardSchema']>,
            GuardBody<Spec['guardSchema']>
        >,
        Spec['tags'],
        Spec['codes'],
        Spec['identities'],
        unknown,
        Spec['requestContext'],
        P,
        J,
        T,
        Spec['guardSchema'],
        TA
    >;
    /**
     * Emit a validation issue with a machine-readable `code`, checked against the
     * codes declared under `validation.issueCodes`.
     *
     * @example
     * const phone = z.string().superRefine((value, ctx) => {
     *     if (isValidPhoneNumber(value)) return;
     *     k.issue(ctx, {
     *         code: 'invalid_phone_number',
     *         message: 'Invalid phone number',
     *         input: value,
     *     });
     * });
     */
    issue<Input>(ctx: z.core.$RefinementCtx<Input>, issue: RegisteredIssue<Spec['codes'], Input>): void;
}

/**
 * The spec a {@link Kizuna} instance's type parameters assemble into.
 */
type SpecOf<
    Tags extends Record<string, TagOptions>,
    Codes extends string,
    Identities extends Record<string, SecurityScheme>,
    RequestContext extends Record<string, RequestContextSchema>,
    GuardSchema extends z.ZodType | undefined,
> = {
    tags: Tags;
    codes: Codes;
    identities: Identities;
    requestContext: RequestContext;
    guardSchema: GuardSchema;
};

/**
 * The tags, identities, request contexts and custom validation issue codes one
 * API surface is bound to. Routes, access, jobs and plugins go on `k.contract`.
 */
export interface KizunaConfig<
    Tags extends Record<string, TagOptions> = Record<string, never>,
    Codes extends string = never,
    Identities extends Record<string, SecurityScheme> = Record<string, never>,
    RequestContext extends Record<string, RequestContextSchema> = Record<string, never>,
    GuardSchema extends z.ZodType | undefined = undefined,
> {
    identities?: Identities;
    requestContext?: RequestContext;
    /**
     * The body every guard's `deny()` produces, and the body each guarded
     * route's `401` and `403` carry. Extend `ProblemDetailsSchema`. Every field
     * you add must be optional or carry a `.default()`, because kizuna sends
     * this itself when a route's `requires` turns a caller away.
     *
     * @example
     * guardSchema: ProblemDetailsSchema.extend({
     *     code: z.enum(['unauthenticated', 'expired_token', 'forbidden']).default('forbidden'),
     * }),
     */
    guardSchema?: GuardSchema & GuardSchemaCheck<GuardSchema>;
    tags?: TagSet<Tags>;
    validation?: {
        issueCodes?: readonly Codes[];
    };
    /**
     * Settings shared by every job. The jobs themselves are declared with `k.jobs`.
     */
    jobs?: JobsConfig;
}

const createSurface = <
    Tags extends Record<string, TagOptions>,
    Codes extends string,
    Identities extends Record<string, SecurityScheme>,
    RequestContext extends Record<string, RequestContextSchema>,
    GuardSchema extends z.ZodType | undefined,
>(
    config?: KizunaConfig<Tags, Codes, Identities, RequestContext, GuardSchema>
): K<SpecOf<Tags, Codes, Identities, RequestContext, GuardSchema>> => {
    type Spec = SpecOf<Tags, Codes, Identities, RequestContext, GuardSchema>;
    if (config?.guardSchema) assertFillableGuardSchema(config.guardSchema);

    const tagSet: TagSet<Tags> = config?.tags ?? { __brand: 'TagSet', tags: {} as Tags };

    const routes = ((tagOrDefs: string | Routes, defs?: Routes) => {
        if (defs === undefined) {
            return tagRoutes(tagOrDefs as Routes);
        }
        return tagRoutes(tagSet, tagOrDefs as Extract<keyof Tags, string>, defs as Routes<Extract<keyof Tags, string>>);
    }) as K<Spec>['routes'];

    const jobs = ((identityOrDefinitions: string | AuthoredJobs, definitions?: AuthoredJobs) =>
        definitions === undefined
            ? buildJobs(undefined, identityOrDefinitions as AuthoredJobs)
            : buildJobs(identityOrDefinitions as string, definitions)) as K<Spec>['jobs'];

    const tools = ((definitions: AuthoredToolsArg<AuthoredTools>) => buildTools(resolveAuthoredTools(definitions))) as K<Spec>['tools'];

    const contract = (definition: {
        routes: Routes;
        jobs?: Jobs;
        tools?: Tools;
        toolAccessControl?: Record<string, unknown>;
        plugins?: ContractPluginsArg<Routes, ContractPlugins>;
        accessControl?: Record<string, GroupAccessControl>;
    }) => {
        const { routes: contractRoutes, jobs: contractJobs, tools: contractTools, toolAccessControl, accessControl } = definition;
        const plugins =
            typeof definition.plugins === 'function'
                ? definition.plugins({
                      routes: contractRoutes,
                      tools: contractTools ?? {},
                  })
                : definition.plugins;
        assertNoPathCollisions([
            ...routeClaims(contractRoutes),
            ...routeClaims(pluginRouteTree(plugins), 'Plugin route'),
            ...jobClaims(contractJobs, config?.jobs),
        ]);
        assertValidDeprecationDates(contractRoutes);
        assertValidDeprecationDates(pluginRouteTree(plugins));
        if (contractTools) {
            if (toolAccessControl) applyToolAccessControl(contractTools, toolAccessControl, config?.identities);
            attachRouteKeys(
                contractTools,
                new Map(flattenRoutes(contractRoutes).map(({ route, routeKey, routeTags }) => [route, { routeKey, routeTags }]))
            );
        }
        if (accessControl) {
            for (const groupKey of Object.keys(accessControl)) {
                if (!(groupKey in contractRoutes)) {
                    throw new Error(`Access control map key '${groupKey}' does not match a route group in the contract.`);
                }
            }
            for (const [groupKey, group] of Object.entries(contractRoutes)) {
                const groupAccess = accessControl[groupKey];
                if (groupAccess === undefined || !group || typeof group !== 'object') continue;
                if (isRouteDefinition(group)) {
                    resolveAccessControlValue(
                        group,
                        (hasCascade(groupAccess) ? groupAccess['*'] : groupAccess) as AccessControlValue,
                        config?.identities,
                        groupKey
                    );
                } else {
                    applyGroupAccessControl(group as Routes, groupAccess, groupKey, config?.identities);
                }
            }
        }
        // After the access control map resolves, so both of these can read `security`.
        injectGuardResponses(contractRoutes, config?.identities, config?.guardSchema);
        assertValidCache(contractRoutes);
        assertValidCache(pluginRouteTree(plugins));
        return assembleContract({
            routes: contractRoutes as Routes<Extract<keyof Tags, string>, Extract<keyof Identities, string>>,
            jobs: contractJobs,
            tools: contractTools,
            toolAccessControl,
            accessControl,
            tags: config?.tags,
            securitySchemes: config?.identities,
            guardSchema: config?.guardSchema,
            requestContext: config?.requestContext,
            validation: config?.validation,
            plugins,
            jobsConfig: config?.jobs,
        });
    };

    const k: K<Spec> = {
        routes,
        jobs,
        tools,
        accessControl: Object.assign((_routes: unknown, map: unknown) => map, {
            tools: (_tools: unknown, map: unknown) => map,
        }) as K<Spec>['accessControl'],
        contract: contract as K<Spec>['contract'],
        issue: addCodedIssue,
    };

    return k;
};

/**
 * Declare one API surface: its tags, identities, request contexts and custom
 * validation issue codes. Keep the instance and use `k.routes` to define route
 * groups, `k.accessControl` to type the access control map, and `k.contract` to assemble
 * them.
 *
 * The authoring helpers that need no instance stay static: `Kizuna.tags`,
 * `Kizuna.identity`, `Kizuna.roles`, `Kizuna.permissions`,
 * `Kizuna.requestContext` and `Kizuna.model`.
 *
 * @example
 * export const k = new Kizuna({
 *     identities: {
 *         user,
 *     },
 *     tags,
 *     validation: {
 *         issueCodes: ['invalid_phone_number'],
 *     },
 * });
 */
export class Kizuna<
    const Tags extends Record<string, TagOptions> = Record<string, never>,
    const Codes extends string = never,
    const Identities extends Record<string, SecurityScheme> = Record<string, never>,
    const RequestContext extends Record<string, RequestContextSchema> = Record<string, never>,
    GuardSchema extends z.ZodType | undefined = undefined,
> implements K<SpecOf<Tags, Codes, Identities, RequestContext, GuardSchema>> {
    static readonly tags = createTags;
    static readonly identity = createIdentity;
    static readonly permissions = createPermissions;
    /**
     * Declare the roles callers hold, as names or from a permission catalog.
     */
    static readonly roles = createRoles;
    static readonly requestContext = createRequestContext;
    static readonly model = createModel;

    declare readonly routes: K<SpecOf<Tags, Codes, Identities, RequestContext, GuardSchema>>['routes'];
    declare readonly accessControl: K<SpecOf<Tags, Codes, Identities, RequestContext, GuardSchema>>['accessControl'];
    declare readonly jobs: K<SpecOf<Tags, Codes, Identities, RequestContext, GuardSchema>>['jobs'];
    declare readonly tools: K<SpecOf<Tags, Codes, Identities, RequestContext, GuardSchema>>['tools'];
    declare readonly contract: K<SpecOf<Tags, Codes, Identities, RequestContext, GuardSchema>>['contract'];
    declare readonly issue: K<SpecOf<Tags, Codes, Identities, RequestContext, GuardSchema>>['issue'];

    constructor(config?: KizunaConfig<Tags, Codes, Identities, RequestContext, GuardSchema>) {
        Object.assign(this, createSurface<Tags, Codes, Identities, RequestContext, GuardSchema>(config));
    }
}
