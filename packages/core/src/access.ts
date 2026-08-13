import type { AuthValue } from './kizuna.js';
import type { PermissionValue } from './permissions.js';
import type { RouteDefinition, Routes } from './types.js';

/**
 * A route's access stated in full: which identity, and what that caller must be
 * permitted. A public route has no caller, so it cannot demand a permission.
 */
export type AccessEntry<Id extends string = string, Name extends string = string> =
    | {
          auth: false;
          permission?: never;
      }
    | {
          auth: Exclude<AuthValue<Id>, false>;
          permission?: PermissionValue<Name>;
      };

/**
 * What a route or group resolves to in the `access` map: an {@link AuthValue} on
 * its own, or an {@link AccessEntry} naming both.
 */
export type AccessValue<Id extends string = string, Name extends string = string> = AuthValue<Id> | AccessEntry<Id, Name>;

/**
 * A group's entry: one {@link AccessValue} for the whole group, or a cascade
 * `{ '*': default, key: override }` whose named keys are the group's own routes
 * and subgroups.
 */
export type GroupAccess<Id extends string = string, Name extends string = string, Group = Routes> = Group extends RouteDefinition
    ? AccessValue<Id, Name>
    : AccessValue<Id, Name> | GroupAccessCascade<Id, Name, Group>;

interface LooseGroupAccessCascade<Id extends string = string, Name extends string = string> {
    '*': AccessValue<Id, Name>;
    [key: string]: AccessValue<Id, Name> | LooseGroupAccessCascade<Id, Name>;
}

export type GroupAccessCascade<Id extends string = string, Name extends string = string, Group = Routes> = string extends keyof Group
    ? LooseGroupAccessCascade<Id, Name>
    : {
          '*': AccessValue<Id, Name>;
      } & {
          [Key in keyof Group & string]?: GroupAccess<Id, Name, Group[Key]>;
      };

/**
 * The `access` map passed to `k.contract`: keyed by route group, every group
 * present, values checked against the contract's identity and permission names.
 */
export type AccessMap<Id extends string = string, Name extends string = string, GroupsOrRoutes = Record<string, Routes>> = [
    GroupsOrRoutes,
] extends [string]
    ? { [Group in GroupsOrRoutes]: GroupAccess<Id, Name> }
    : { [Group in keyof GroupsOrRoutes & string]: GroupAccess<Id, Name, GroupsOrRoutes[Group]> };

/**
 * Rechecks an inferred `access` map against the routes, erroring on keys plain
 * assignability would let through as excess properties.
 */
export type ValidAccessMap<A, R, Id extends string, Name extends string> = {
    [Group in keyof A]: Group extends keyof R ? ValidGroupAccess<A[Group], R[Group], Id, Name> : never;
};

type ValidGroupAccess<Entry, Group, Id extends string, Name extends string> = Group extends RouteDefinition
    ? Entry extends { '*': unknown }
        ? never
        : AccessValue<Id, Name>
    : Entry extends { '*': unknown }
      ? {
            [Key in keyof Entry]: Key extends '*'
                ? AccessValue<Id, Name>
                : Key extends keyof Group
                  ? ValidGroupAccess<Entry[Key], Group[Key], Id, Name>
                  : never;
        }
      : AccessValue<Id, Name>;

/**
 * True for the `{ auth, permission }` form rather than a bare {@link AuthValue}.
 * An identity may not be named `auth`, which `k.contract` rejects, so the key is
 * unambiguous.
 */
export const isAccessEntry = (value: unknown): value is AccessEntry =>
    typeof value === 'object' && value !== null && !Array.isArray(value) && 'auth' in value;

/**
 * The auth half of an {@link AccessValue}.
 */
export const authOf = (value: AccessValue): AuthValue => (isAccessEntry(value) ? value.auth : (value as AuthValue));

/**
 * The permission half, or `undefined` when the value states none.
 */
export const permissionOf = (value: AccessValue): PermissionValue | undefined =>
    isAccessEntry(value) ? (value.permission as PermissionValue | undefined) : undefined;

/**
 * Whether the value states a permission at all, as opposed to stating none. A
 * bare auth value inherits the group's permission; an entry that names the key
 * replaces it.
 */
export const statesPermission = (value: AccessValue): boolean => isAccessEntry(value) && 'permission' in value;

/**
 * The auth half of one {@link AccessValue}, at the type level.
 */
type AuthPartOfValue<Value> = Value extends { auth: infer Auth } ? Auth : Value;

/**
 * An access map reduced to the auth map it contains. Everything downstream of
 * `k.contract` (handler context, adapters, the generators) is typed against auth
 * alone, so the merged map is unwrapped once here rather than threaded through.
 */
export type AuthMapOf<Access> = {
    [Group in keyof Access]: AuthPartOfGroup<Access[Group]>;
};

type AuthPartOfGroup<Entry> = Entry extends { '*': infer Default }
    ? {
          [Key in keyof Entry]: Key extends '*' ? AuthPartOfValue<Default> : AuthPartOfGroup<Entry[Key]>;
      }
    : AuthPartOfValue<Entry>;

const hasCascade = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value) && '*' in value;

/**
 * Split one `access` map into the auth map and permissions map the contract
 * resolves separately. A bare auth value states no permission, so it inherits the
 * group's; an entry naming the key replaces it.
 */
export const splitAccessMap = (
    access: Record<string, GroupAccess>
): {
    auth: Record<string, unknown>;
    permissions: Record<string, unknown>;
} => {
    const auth: Record<string, unknown> = {};
    const permissions: Record<string, unknown> = {};
    for (const [group, entry] of Object.entries(access)) {
        auth[group] = splitAuth(entry, group);
        permissions[group] = splitPermission(entry, group);
    }
    return {
        auth,
        permissions,
    };
};

const splitAuth = (entry: GroupAccess, path: string): unknown => {
    if (hasCascade(entry)) {
        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(entry)) {
            out[key] = splitAuth(value as GroupAccess, `${path}.${key}`);
        }
        return out;
    }
    assertPermissionHasCaller(entry as AccessValue, path);
    return authOf(entry as AccessValue);
};

const splitPermission = (entry: GroupAccess, path: string): unknown => {
    if (hasCascade(entry)) {
        const cascade = entry as unknown as Record<string, GroupAccess> & { '*': GroupAccess };
        const out: Record<string, unknown> = {
            '*': splitPermission(cascade['*'], `${path}.*`),
        };
        for (const [key, value] of Object.entries(cascade)) {
            if (key === '*') continue;
            if (hasCascade(value)) {
                out[key] = splitPermission(value as GroupAccess, `${path}.${key}`);
                continue;
            }
            // A bare auth value states nothing about permissions, so leaving the key
            // out is what lets it inherit the group's. Turning a route public is the
            // exception: it has no caller left to hold one.
            if (!statesPermission(value as AccessValue)) {
                if (authOf(value as AccessValue) === false) out[key] = false;
                continue;
            }
            out[key] = splitPermission(value as GroupAccess, `${path}.${key}`);
        }
        return out;
    }
    assertPermissionHasCaller(entry as AccessValue, path);
    return permissionOf(entry as AccessValue) ?? false;
};

/**
 * A permission asks whether one caller may do something, so a public route has
 * nobody to ask about. The types refuse the direct form; this catches the ones
 * that only become public through a cascade.
 */
const assertPermissionHasCaller = (value: AccessValue, path: string): void => {
    if (authOf(value) !== false) return;
    const permission = permissionOf(value);
    if (permission === undefined || permission === false) return;
    throw new Error(
        `'${path}' is public and demands a permission. A permission asks what one caller may do, and a public route has no caller. ` +
            `Give it an identity, or check the condition in the handler.`
    );
};
