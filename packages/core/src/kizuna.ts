import type { z } from 'zod';
import { tagRoutes } from './routes.js';
import { assembleContract, type Contract } from './contract.js';
import { isRouteDefinition } from './handler-pipeline.js';
import { type TagSet, type TagOptions } from './tags.js';
import type { Routes, RouteDefinition, SecurityRequirement, AccessGate, AuthoredRoutes } from './types.js';
import type { SecurityScheme } from './security-scheme.js';
import type { RequestContextSchema } from './request-context.js';

/**
 * A constraint on an identity's `access` fields: each key is a field, each value
 * the allowed value or values, e.g. `{ role: 'owner' }` or
 * `{ role: ['owner', 'admin'] }`.
 */
export type AccessConstraint = Record<string, unknown>;

/**
 * The auth a route or group resolves to:
 *
 * - a scheme name — require that identity, no field constraint;
 * - `false` — public;
 * - `{ scheme: true }` — require that identity inside a multi-identity value
 *   (multiple scheme keys are combined with AND);
 * - `{ scheme: { field: value | values } }` — constrain `access` fields;
 * - `{ scheme: [...scopes] }` — oauth2 scopes.
 */
export type AuthValue<Id extends string = string> = Id | false | { [Name in Id]?: true | AccessConstraint | readonly string[] };

/**
 * A group's entry in the `auth` map: one {@link AuthValue} for the whole group,
 * or a cascade object `{ '*': default, routeKey: override }` where the `'*'` key
 * sets the group default and named keys override individual routes.
 */
export type GroupAuth<Id extends string = string> = AuthValue<Id> | ({ '*': AuthValue<Id> } & { [route: string]: AuthValue<Id> });

/**
 * The `auth` map passed to `k.contract`: keyed by route group (every group must
 * appear), with values checked against the contract's identity names.
 */
export type AuthMap<Id extends string = string, Groups extends string = string> = { [Group in Groups]: GroupAuth<Id> };

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

const hasCascade = (value: GroupAuth): value is { '*': AuthValue } & Record<string, AuthValue> =>
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
 * Resolve a group's {@link GroupAuth} across its routes, applying either the
 * cascade (`'*'` default merged with per-route entries) or a single value to
 * every route in the group.
 */
const applyGroupAuth = (group: Routes, groupAuth: GroupAuth): void => {
    const cascade = hasCascade(groupAuth);
    const groupDefault = (cascade ? groupAuth['*'] : groupAuth) as AuthValue;
    for (const [routeKey, value] of Object.entries(group)) {
        if (!isRouteDefinition(value)) {
            applyGroupAuth(value as Routes, cascade ? groupAuth : groupDefault);
            continue;
        }
        const override = cascade ? (groupAuth as Record<string, AuthValue | undefined>)[routeKey] : undefined;
        const routeAuth = override === undefined ? groupDefault : mergeAuthValue(groupDefault, override);
        resolveAuthValue(value as RouteDefinition, routeAuth);
    }
};

/**
 * The handle `kizuna` returns. `k.routes` defines route groups; `k.contract`
 * assembles them into the contract.
 */
export interface K<
    Tags extends Record<string, TagOptions>,
    Codes extends string,
    Identities extends Record<string, SecurityScheme> = Record<string, never>,
    RequestContext extends Record<string, RequestContextSchema> = Record<string, never>,
> {
    /**
     * Define a group of routes. Pass a tag (one of the keys from `createTags`)
     * to group them in the OpenAPI document, or omit it for an untagged group.
     */
    routes<const T extends AuthoredRoutes<Extract<keyof Tags, string>>>(tag: Extract<keyof Tags, string>, defs: T): T;
    routes<const T extends AuthoredRoutes>(defs: T): T;
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
    auth<
        const R extends Routes<Extract<keyof Tags, string>, Extract<keyof Identities, string>>,
        const A extends AuthMap<Extract<keyof Identities, string>, Extract<keyof R, string>>,
    >(
        routes: R,
        map: A
    ): A;
    /**
     * Assemble route groups into a contract. The `auth` map assigns each group
     * (and optionally each route, via a `'*'` cascade) the identity it requires;
     * `k.contract` resolves it onto every route's `security` and `accessGate`.
     */
    contract<
        const R extends Routes<Extract<keyof Tags, string>, Extract<keyof Identities, string>>,
        const A extends AuthMap<Extract<keyof Identities, string>, Extract<keyof R, string>>,
    >(definition: {
        routes: R;
        auth: A;
    }): Contract<R, Tags, Codes, Identities, A, RequestContext>;
    contract<const R extends Routes<Extract<keyof Tags, string>, Extract<keyof Identities, string>>>(definition: {
        routes: R;
    }): Contract<R, Tags, Codes, Identities, unknown, RequestContext>;
}

/**
 * The typed factory for one API surface. Destructure `k`, then use `k.routes` to
 * define route groups and `k.contract` to assemble them into the contract.
 *
 * @example
 * const { k } = kizuna({
 *     identities: {
 *         user,
 *     },
 *     tags,
 *     validation: {
 *         issueCodes: ['invalid_phone_number'],
 *     },
 * });
 */
export const kizuna = <
    const Tags extends Record<string, TagOptions> = Record<string, never>,
    const Codes extends string = never,
    const Identities extends Record<string, SecurityScheme> = Record<string, never>,
    const RequestContext extends Record<string, RequestContextSchema> = Record<string, never>,
>(config?: {
    identities?: Identities;
    requestContext?: RequestContext;
    tags?: TagSet<Tags>;
    validation?: {
        issueCodes?: readonly Codes[];
    };
}): { k: K<Tags, Codes, Identities, RequestContext> } => {
    const tagSet: TagSet<Tags> = config?.tags ?? { __brand: 'TagSet', tags: {} as Tags };

    const routes = ((tagOrDefs: string | Routes, defs?: Routes) => {
        if (defs === undefined) {
            return tagRoutes(tagOrDefs as Routes);
        }
        return tagRoutes(tagSet, tagOrDefs as Extract<keyof Tags, string>, defs as Routes<Extract<keyof Tags, string>>);
    }) as K<Tags, Codes, Identities, RequestContext>['routes'];

    const contract = (definition: { routes: Routes; auth?: Record<string, GroupAuth> }) => {
        const { routes: contractRoutes, auth } = definition;
        if (auth) {
            for (const [groupKey, group] of Object.entries(contractRoutes)) {
                const groupAuth = auth[groupKey];
                if (groupAuth === undefined || !group || typeof group !== 'object') continue;
                if (isRouteDefinition(group)) {
                    resolveAuthValue(group, (hasCascade(groupAuth) ? groupAuth['*'] : groupAuth) as AuthValue);
                } else {
                    applyGroupAuth(group as Routes, groupAuth);
                }
            }
        }
        return assembleContract({
            routes: contractRoutes as Routes<Extract<keyof Tags, string>, Extract<keyof Identities, string>>,
            auth,
            tags: config?.tags,
            securitySchemes: config?.identities,
            requestContext: config?.requestContext,
            validation: config?.validation,
        });
    };

    const k: K<Tags, Codes, Identities, RequestContext> = {
        routes,
        auth: (_routes, map) => map,
        contract: contract as K<Tags, Codes, Identities, RequestContext>['contract'],
    };

    return { k };
};
