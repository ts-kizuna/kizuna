import type { z } from 'zod';
import { tagRoutes } from './routes.js';
import { assembleContract, type Contract } from './contract.js';
import type { ContractPlugins, PluginArgs } from './plugin.js';
import { addCodedIssue, type RegisteredIssue } from './coded-issue.js';
import { flattenRoutes, isRouteDefinition, type RoutesWithHandlerContext } from './handler-pipeline.js';
import {
    assertNoJobEndpointCollision,
    buildJobs,
    type AuthoredJobs,
    type CompiledJobs,
    type Jobs,
    type JobsArg,
    type JobsConfig,
} from './jobs.js';
import { createTags, type TagSet, type TagOptions } from './tags.js';
import { createIdentity } from './identity.js';
import { createRequestContext } from './request-context.js';
import { createModel } from './model.js';
import type { Routes, RouteDefinition, SecurityRequirement, AccessGate, AuthoredRoutes } from './types.js';
import type { SecurityScheme } from './security-scheme.js';
import type { RequestContextSchema } from './request-context.js';
import type { PathParamsCheck } from '@ts-kizuna/shared';

/**
 * A constraint on an identity's `access` fields: each key is a field, each value
 * the allowed value or values, e.g. `{ role: 'owner' }` or
 * `{ role: ['owner', 'admin'] }`.
 */
export type AccessConstraint = Record<string, unknown>;

/**
 * The auth a route or group resolves to:
 *
 * - a scheme name: require that identity, no field constraint;
 * - `false`: public;
 * - `{ scheme: true }`: require that identity inside a multi-identity value
 *   (multiple scheme keys are combined with AND);
 * - `{ scheme: { field: value | values } }`: constrain `access` fields;
 * - `{ scheme: [...scopes] }`: oauth2 scopes.
 */
export type AuthValue<Id extends string = string> = Id | false | { [Name in Id]?: true | AccessConstraint | readonly string[] };

/**
 * A group's entry in the `auth` map: one {@link AuthValue} for the whole group,
 * or a cascade `{ '*': default, key: override }` whose named keys are the
 * group's own routes and subgroups, an {@link AuthValue}, or a nested cascade
 * (an object with its own `'*'`) for a subgroup.
 */
export type GroupAuth<Id extends string = string, Group = Routes> = Group extends RouteDefinition
    ? AuthValue<Id>
    : AuthValue<Id> | GroupAuthCascade<Id, Group>;

/**
 * The cascade form of {@link GroupAuth} when the group's shape isn't statically
 * known.
 */
interface LooseGroupAuthCascade<Id extends string = string> {
    '*': AuthValue<Id>;
    [key: string]: AuthValue<Id> | LooseGroupAuthCascade<Id>;
}

/**
 * The cascade form of {@link GroupAuth}.
 */
export type GroupAuthCascade<Id extends string = string, Group = Routes> = string extends keyof Group
    ? LooseGroupAuthCascade<Id>
    : {
          '*': AuthValue<Id>;
      } & {
          [Key in keyof Group & string]?: GroupAuth<Id, Group[Key]>;
      };

/**
 * The `auth` map passed to `k.contract`: keyed by route group (every group must
 * appear), with values checked against the contract's identity names. The second
 * parameter takes the routes type, or a union of group names for the unshaped form.
 */
export type AuthMap<Id extends string = string, GroupsOrRoutes = Record<string, Routes>> = [GroupsOrRoutes] extends [string]
    ? { [Group in GroupsOrRoutes]: GroupAuth<Id> }
    : { [Group in keyof GroupsOrRoutes & string]: GroupAuth<Id, GroupsOrRoutes[Group]> };

/**
 * Rechecks an inferred `auth` map against the routes, erroring on keys that
 * plain assignability would let through as excess properties.
 */
export type ValidAuthMap<A, R, Id extends string> = {
    [Group in keyof A]: Group extends keyof R ? ValidGroupAuth<A[Group], R[Group], Id> : never;
};

type ValidGroupAuth<Entry, Group, Id extends string> = Group extends RouteDefinition
    ? Entry extends { '*': unknown }
        ? never
        : AuthValue<Id>
    : Entry extends { '*': unknown }
      ? {
            [Key in keyof Entry]: Key extends '*'
                ? AuthValue<Id>
                : Key extends keyof Group
                  ? ValidGroupAuth<Entry[Key], Group[Key], Id>
                  : never;
        }
      : AuthValue<Id>;

/**
 * Apply one {@link AuthValue} to a single route, setting its `security` and,
 * when fields are constrained, its `accessGate`.
 */
const resolveAuthValue = (route: RouteDefinition, value: AuthValue): void => {
    if (value === false) {
        route.security = [];
        return;
    }
    if (typeof value === 'string') {
        route.security = [value];
        return;
    }
    const requirement: Record<string, readonly string[]> = {};
    const gate: AccessGate = {};
    for (const [scheme, constraint] of Object.entries(value)) {
        if (constraint === true) {
            requirement[scheme] = [];
        } else if (Array.isArray(constraint)) {
            requirement[scheme] = constraint as readonly string[];
        } else {
            requirement[scheme] = [];
            const fields = constraint as AccessConstraint;
            if (Object.keys(fields).length > 0) gate[scheme] = fields;
        }
    }
    route.security = [requirement as SecurityRequirement];
    if (Object.keys(gate).length > 0) route.accessGate = gate;
};

const hasCascade = (value: unknown): value is { '*': AuthValue } & Record<string, AuthValue | GroupAuth> =>
    typeof value === 'object' && value !== null && !Array.isArray(value) && '*' in value;

const toIdentityMap = (value: AuthValue): Record<string, true | AccessConstraint | readonly string[]> => {
    if (value === false) return {};
    if (typeof value === 'string') return { [value]: true };
    return value as Record<string, true | AccessConstraint | readonly string[]>;
};

/**
 * Merge a route's auth entry into the group's `'*'` default. The route inherits
 * the default's identities and refines or adds per identity; `false` opts the
 * route out entirely.
 */
const mergeAuthValue = (groupDefault: AuthValue, override: AuthValue): AuthValue => {
    if (override === false) return false;
    return { ...toIdentityMap(groupDefault), ...toIdentityMap(override) } as AuthValue;
};

/**
 * Resolve a group's {@link GroupAuth} across its subtree. Cascade keys address
 * the group's own routes and subgroups; a key matching none would be a silent
 * no-op, so it throws instead.
 */
const applyGroupAuth = (group: Routes, groupAuth: GroupAuth, path: string): void => {
    const cascade = hasCascade(groupAuth);
    const groupDefault = (cascade ? groupAuth['*'] : groupAuth) as AuthValue;
    if (cascade) {
        for (const overrideKey of Object.keys(groupAuth)) {
            if (overrideKey !== '*' && !(overrideKey in group)) {
                throw new Error(`Auth cascade key '${overrideKey}' does not match a route or group directly under '${path}'.`);
            }
        }
    }
    for (const [key, value] of Object.entries(group)) {
        const entry = cascade ? (groupAuth as Record<string, GroupAuth | undefined>)[key] : undefined;
        if (!isRouteDefinition(value)) {
            const subgroup = value as Routes;
            const subPath = `${path}.${key}`;
            if (entry === undefined) {
                applyGroupAuth(subgroup, groupDefault, subPath);
            } else if (hasCascade(entry)) {
                applyGroupAuth(
                    subgroup,
                    {
                        ...entry,
                        '*': mergeAuthValue(groupDefault, entry['*']),
                    },
                    subPath
                );
            } else {
                applyGroupAuth(subgroup, mergeAuthValue(groupDefault, entry as AuthValue), subPath);
            }
            continue;
        }
        if (hasCascade(entry)) {
            throw new Error(`Auth cascade key '${key}' under '${path}' targets a route; a nested cascade only applies to a group.`);
        }
        const routeAuth = entry === undefined ? groupDefault : mergeAuthValue(groupDefault, entry as AuthValue);
        resolveAuthValue(value as RouteDefinition, routeAuth);
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
    plugins: ContractPlugins;
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
 * The plugins declared on a spec, e.g. `{ mcp: McpPlugin }`.
 */
export type PluginsOf<Spec extends KizunaSpec> = Spec['plugins'];

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
     * The `auth` map, typed against the routes and identities. Define it wherever
     * you like, then pass it to `k.contract` under `auth`.
     *
     * @example
     * export const auth = k.auth(routes, {
     *     users: false,
     *     members: 'user',
     * });
     */
    auth<const R extends Routes<TagNamesOf<Spec>, IdentityNamesOf<Spec>>, const A extends AuthMap<IdentityNamesOf<Spec>, R>>(
        routes: R,
        map: A & ValidAuthMap<A, R, IdentityNamesOf<Spec>>
    ): A;
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
     * Assemble route groups into a contract. The `auth` map assigns each group
     * (and optionally each route, via a `'*'` cascade) the identity it requires;
     * `k.contract` resolves it onto every route's `security` and `accessGate`.
     *
     * Jobs declared with `k.jobs` go under `jobs`, alongside `routes` rather than
     * inside it. They carry their own identity, so they never appear in the
     * `auth` map.
     */
    contract<
        const R extends Routes<TagNamesOf<Spec>, IdentityNamesOf<Spec>>,
        const A extends AuthMap<IdentityNamesOf<Spec>, R>,
        const J extends Jobs = Record<string, never>,
    >(definition: {
        routes: R;
        jobs?: J;
        auth: A & ValidAuthMap<A, R, IdentityNamesOf<Spec>>;
    }): Contract<
        RoutesWithHandlerContext<R, Spec['identities'], A, Spec['requestContext'], PluginArgs<PluginsOf<Spec>> & JobsArg<J>>,
        Spec['tags'],
        Spec['codes'],
        Spec['identities'],
        A,
        Spec['requestContext'],
        PluginsOf<Spec>,
        J
    >;
    contract<const R extends Routes<TagNamesOf<Spec>, IdentityNamesOf<Spec>>, const J extends Jobs = Record<string, never>>(definition: {
        routes: R;
        jobs?: J;
    }): Contract<
        RoutesWithHandlerContext<R, Spec['identities'], unknown, Spec['requestContext'], PluginArgs<PluginsOf<Spec>> & JobsArg<J>>,
        Spec['tags'],
        Spec['codes'],
        Spec['identities'],
        unknown,
        Spec['requestContext'],
        PluginsOf<Spec>,
        J
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
    Plugins extends ContractPlugins,
> = {
    tags: Tags;
    codes: Codes;
    identities: Identities;
    requestContext: RequestContext;
    plugins: Plugins;
};

/**
 * The tags, identities, request contexts, plugins and custom validation issue
 * codes one API surface is bound to.
 */
export interface KizunaConfig<
    Tags extends Record<string, TagOptions> = Record<string, never>,
    Codes extends string = never,
    Identities extends Record<string, SecurityScheme> = Record<string, never>,
    RequestContext extends Record<string, RequestContextSchema> = Record<string, never>,
    Plugins extends ContractPlugins = Record<string, never>,
> {
    identities?: Identities;
    requestContext?: RequestContext;
    tags?: TagSet<Tags>;
    validation?: {
        issueCodes?: readonly Codes[];
    };
    /**
     * Plugins to install, keyed by name. That key is what handlers read under
     * `plugins`.
     */
    plugins?: Plugins;
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
    Plugins extends ContractPlugins,
>(
    config?: KizunaConfig<Tags, Codes, Identities, RequestContext, Plugins>
): K<SpecOf<Tags, Codes, Identities, RequestContext, Plugins>> => {
    type Spec = SpecOf<Tags, Codes, Identities, RequestContext, Plugins>;

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

    const contract = (definition: { routes: Routes; jobs?: Jobs; auth?: Record<string, GroupAuth> }) => {
        const { routes: contractRoutes, jobs: contractJobs, auth } = definition;
        if (contractJobs) {
            const routePaths = new Map<string, string>();
            for (const { routeKey, route } of flattenRoutes(contractRoutes)) {
                routePaths.set(`${route.method}:${route.path}`, routeKey);
            }
            assertNoJobEndpointCollision(contractJobs, config?.jobs, routePaths);
        }
        if (auth) {
            for (const groupKey of Object.keys(auth)) {
                if (!(groupKey in contractRoutes)) {
                    throw new Error(`Auth map key '${groupKey}' does not match a route group in the contract.`);
                }
            }
            for (const [groupKey, group] of Object.entries(contractRoutes)) {
                const groupAuth = auth[groupKey];
                if (groupAuth === undefined || !group || typeof group !== 'object') continue;
                if (isRouteDefinition(group)) {
                    resolveAuthValue(group, (hasCascade(groupAuth) ? groupAuth['*'] : groupAuth) as AuthValue);
                } else {
                    applyGroupAuth(group as Routes, groupAuth, groupKey);
                }
            }
        }
        return assembleContract({
            routes: contractRoutes as Routes<Extract<keyof Tags, string>, Extract<keyof Identities, string>>,
            jobs: contractJobs,
            auth,
            tags: config?.tags,
            securitySchemes: config?.identities,
            requestContext: config?.requestContext,
            validation: config?.validation,
            plugins: config?.plugins,
            jobsConfig: config?.jobs,
        });
    };

    const k: K<Spec> = {
        routes,
        jobs,
        auth: (_routes, map) => map,
        contract: contract as K<Spec>['contract'],
        issue: addCodedIssue,
    };

    return k;
};

/**
 * Declare one API surface: its tags, identities, request contexts and custom
 * validation issue codes. Keep the instance and use `k.routes` to define route
 * groups, `k.auth` to type the auth map, and `k.contract` to assemble them.
 *
 * The authoring helpers that need no instance stay static: `Kizuna.tags`,
 * `Kizuna.identity`, `Kizuna.requestContext` and `Kizuna.model`.
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
    const Plugins extends ContractPlugins = Record<string, never>,
> implements K<SpecOf<Tags, Codes, Identities, RequestContext, Plugins>> {
    static readonly tags = createTags;
    static readonly identity = createIdentity;
    static readonly requestContext = createRequestContext;
    static readonly model = createModel;

    declare readonly routes: K<SpecOf<Tags, Codes, Identities, RequestContext, Plugins>>['routes'];
    declare readonly auth: K<SpecOf<Tags, Codes, Identities, RequestContext, Plugins>>['auth'];
    declare readonly jobs: K<SpecOf<Tags, Codes, Identities, RequestContext, Plugins>>['jobs'];
    declare readonly contract: K<SpecOf<Tags, Codes, Identities, RequestContext, Plugins>>['contract'];
    declare readonly issue: K<SpecOf<Tags, Codes, Identities, RequestContext, Plugins>>['issue'];

    constructor(config?: KizunaConfig<Tags, Codes, Identities, RequestContext, Plugins>) {
        Object.assign(this, createSurface<Tags, Codes, Identities, RequestContext, Plugins>(config));
    }
}
