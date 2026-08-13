import { flattenRoutes, isRouteDefinition } from './handler-pipeline.js';
import { isPermission, type Permission } from './permission.js';
import type { PermissionRequirement, RouteDefinition, Routes } from './types.js';

/**
 * The permissions a route or group demands:
 *
 * - `false`: none;
 * - `'viewInvoices'`: requires that permission;
 * - `['viewInvoices', 'exportLedger']`: requires all of them;
 * - `{ oneOf: [...] }`: requires at least one.
 *
 * Only a permission applying to no particular record can appear here. One that
 * applies to a record is answerable in a handler, with `can`, once the record is
 * loaded.
 */
export type PermissionValue<Name extends string = string> = false | Name | readonly Name[] | { oneOf: readonly Name[] };

/**
 * A group's entry in the `permissions` map: one {@link PermissionValue} for the
 * whole group, or a cascade `{ '*': default, key: override }` whose named keys
 * are the group's own routes and subgroups.
 */
export type GroupPermissions<Name extends string = string, Group = Routes> = Group extends RouteDefinition
    ? PermissionValue<Name>
    : PermissionValue<Name> | GroupPermissionsCascade<Name, Group>;

/**
 * The cascade form of {@link GroupPermissions} when the group's shape isn't
 * statically known.
 */
interface LooseGroupPermissionsCascade<Name extends string = string> {
    '*': PermissionValue<Name>;
    [key: string]: PermissionValue<Name> | LooseGroupPermissionsCascade<Name>;
}

/**
 * The cascade form of {@link GroupPermissions}.
 */
export type GroupPermissionsCascade<Name extends string = string, Group = Routes> = string extends keyof Group
    ? LooseGroupPermissionsCascade<Name>
    : {
          '*': PermissionValue<Name>;
      } & {
          [Key in keyof Group & string]?: GroupPermissions<Name, Group[Key]>;
      };

/**
 * The `permissions` map passed to `k.contract`: keyed by route group (every group
 * must appear), with values checked against the declared permission names.
 */
export type PermissionsMap<Name extends string = string, GroupsOrRoutes = Record<string, Routes>> = [GroupsOrRoutes] extends [string]
    ? { [Group in GroupsOrRoutes]: GroupPermissions<Name> }
    : { [Group in keyof GroupsOrRoutes & string]: GroupPermissions<Name, GroupsOrRoutes[Group]> };

/**
 * Rechecks an inferred `permissions` map against the routes, erroring on keys
 * that plain assignability would let through as excess properties.
 */
export type ValidPermissionsMap<P, R, Name extends string> = {
    [Group in keyof P]: Group extends keyof R ? ValidGroupPermissions<P[Group], R[Group], Name> : never;
};

type ValidGroupPermissions<Entry, Group, Name extends string> = Group extends RouteDefinition
    ? Entry extends { '*': unknown }
        ? never
        : PermissionValue<Name>
    : Entry extends { '*': unknown }
      ? {
            [Key in keyof Entry]: Key extends '*'
                ? PermissionValue<Name>
                : Key extends keyof Group
                  ? ValidGroupPermissions<Entry[Key], Group[Key], Name>
                  : never;
        }
      : PermissionValue<Name>;

const hasCascade = (value: unknown): value is { '*': PermissionValue } & Record<string, PermissionValue | GroupPermissions> =>
    typeof value === 'object' && value !== null && !Array.isArray(value) && '*' in value;

const isOneOf = (value: unknown): value is { oneOf: readonly string[] } =>
    typeof value === 'object' && value !== null && !Array.isArray(value) && 'oneOf' in value;

/**
 * The permission names a route may be gated on: the declared ones applying to no
 * particular record. One that applies to a record is checked in a handler.
 */
export const gateableNames = (permissions: Record<string, Permission> | undefined): Set<string> => {
    const names = new Set<string>();
    for (const [name, permission] of Object.entries(permissions ?? {})) {
        if (!isPermission(permission) || permission.appliesTo !== undefined) continue;
        names.add(name);
    }
    return names;
};

const assertGateable = (
    names: readonly string[],
    gateable: Set<string>,
    declared: Record<string, Permission> | undefined,
    where: string
): void => {
    for (const name of names) {
        if (gateable.has(name)) continue;
        const permission = (declared ?? {})[name];
        if (permission && isPermission(permission)) {
            throw new Error(
                `Permission '${name}' at '${where}' applies to a record, so a route cannot demand it. ` +
                    `The route has not loaded the record yet. Check it in the handler with \`can.${name}(record)\`.`
            );
        }
        throw new Error(
            `Permission '${name}' at '${where}' is not declared. ` +
                `Declared and gateable: ${gateable.size > 0 ? [...gateable].sort().join(', ') : '(none)'}.`
        );
    }
};

/**
 * Normalize one {@link PermissionValue} to the {@link PermissionRequirement} a
 * route carries, or `undefined` when the route demands nothing.
 */
const normalize = (
    value: PermissionValue,
    gateable: Set<string>,
    declared: Record<string, Permission> | undefined,
    where: string
): PermissionRequirement | undefined => {
    if (value === false) return undefined;
    if (typeof value === 'string') {
        assertGateable([value], gateable, declared, where);
        return { all: [value] };
    }
    if (Array.isArray(value)) {
        if (value.length === 0) return undefined;
        assertGateable(value, gateable, declared, where);
        return { all: [...value] };
    }
    if (isOneOf(value)) {
        if (value.oneOf.length === 0) {
            throw new Error(`The permission requirement at '${where}' is an empty 'oneOf', which no caller can satisfy. Use 'false'.`);
        }
        assertGateable(value.oneOf, gateable, declared, where);
        return { oneOf: [...value.oneOf] };
    }
    throw new Error(`The permission requirement at '${where}' is not a permission name, a list, 'oneOf', or false.`);
};

/**
 * Apply one {@link PermissionValue} to a single route.
 */
export const resolvePermissionValue = (
    route: RouteDefinition,
    value: PermissionValue,
    gateable: Set<string>,
    declared: Record<string, Permission> | undefined,
    where: string
): void => {
    const requirement = normalize(value, gateable, declared, where);
    if (requirement) route.permissions = requirement;
};

/**
 * Resolve a group's {@link GroupPermissions} across its subtree. Cascade keys
 * address the group's own routes and subgroups; a key matching none would be a
 * silent no-op, so it throws instead.
 *
 * Unlike the auth map, an override **replaces** the `'*'` default rather than
 * merging into it. Identities are orthogonal credentials that combine; a
 * permission requirement is one statement about a route, and merging it would
 * make `deleteWorkspace: 'deleteWorkspace'` silently also demand the group's
 * default.
 */
export const applyGroupPermissions = (
    group: Routes,
    groupPermissions: GroupPermissions,
    path: string,
    gateable: Set<string>,
    declared: Record<string, Permission> | undefined
): void => {
    const cascade = hasCascade(groupPermissions);
    const groupDefault = (cascade ? groupPermissions['*'] : groupPermissions) as PermissionValue;
    if (cascade) {
        for (const overrideKey of Object.keys(groupPermissions)) {
            if (overrideKey !== '*' && !(overrideKey in group)) {
                throw new Error(`Permissions cascade key '${overrideKey}' does not match a route or group directly under '${path}'.`);
            }
        }
    }
    for (const [key, value] of Object.entries(group)) {
        const entry = cascade ? (groupPermissions as Record<string, GroupPermissions | undefined>)[key] : undefined;
        const subPath = `${path}.${key}`;
        if (!isRouteDefinition(value)) {
            const subgroup = value as Routes;
            if (entry === undefined) {
                applyGroupPermissions(subgroup, groupDefault, subPath, gateable, declared);
            } else if (hasCascade(entry)) {
                applyGroupPermissions(subgroup, entry, subPath, gateable, declared);
            } else {
                applyGroupPermissions(subgroup, entry as PermissionValue, subPath, gateable, declared);
            }
            continue;
        }
        if (hasCascade(entry)) {
            throw new Error(`Permissions cascade key '${key}' under '${path}' targets a route; a nested cascade only applies to a group.`);
        }
        resolvePermissionValue(
            value as RouteDefinition,
            entry === undefined ? groupDefault : (entry as PermissionValue),
            gateable,
            declared,
            subPath
        );
    }
};

/**
 * Resolve a whole `permissions` map onto the contract's routes. Called by
 * `k.contract` after the auth map is resolved.
 */
export const applyPermissionsMap = (
    routes: Routes,
    permissions: Record<string, GroupPermissions>,
    declared: Record<string, Permission> | undefined
): void => {
    const gateable = gateableNames(declared);
    for (const groupKey of Object.keys(permissions)) {
        if (!(groupKey in routes)) {
            throw new Error(`Permissions map key '${groupKey}' does not match a route group in the contract.`);
        }
    }
    for (const [groupKey, group] of Object.entries(routes)) {
        const groupPermissions = permissions[groupKey];
        if (groupPermissions === undefined || !group || typeof group !== 'object') continue;
        if (isRouteDefinition(group)) {
            resolvePermissionValue(
                group,
                (hasCascade(groupPermissions) ? groupPermissions['*'] : groupPermissions) as PermissionValue,
                gateable,
                declared,
                groupKey
            );
        } else {
            applyGroupPermissions(group as Routes, groupPermissions, groupKey, gateable, declared);
        }
    }
};

/**
 * One route and what it demands, as {@link permissionsReport} lists it.
 */
export interface ReportedRoute {
    routeKey: string;
    method: string;
    path: string;
    requirement: PermissionRequirement | undefined;
}

/**
 * Every route and the permissions it demands, plus the ones demanding nothing.
 * Walking the contract beats maintaining that second list by hand.
 */
export const permissionsReport = (
    routes: Routes
): {
    routes: ReportedRoute[];
    ungated: ReportedRoute[];
} => {
    const reported = flattenRoutes(routes).map(({ routeKey, route }) => ({
        routeKey,
        method: route.method,
        path: route.path,
        requirement: route.permissions,
    }));
    return {
        routes: reported,
        ungated: reported.filter((entry) => entry.requirement === undefined),
    };
};
