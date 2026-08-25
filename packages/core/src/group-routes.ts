import { ROUTES_TAG } from './types.js';
import type { AuthoredRoutes, RouteDefinition, RoutePath, Routes } from './types.js';
import type { GroupOptions, GroupPaths, GroupSet } from './groups.js';
import type { PathParamsCheck } from './path-params.js';
import { assertPathBelowPrefix, resolvePath, type AuthoredPath, type ResolvedPath } from './group-path.js';

/**
 * A group's prefix composed onto its ancestors', mirroring the runtime.
 * An `{ absolute }` prefix starts from the root.
 */
type ComposedPrefix<Inherited extends string, Options> = Options extends { pathPrefix: { absolute: infer Absolute extends string } }
    ? Absolute
    : Options extends { pathPrefix: infer Prefix extends string }
      ? `${Inherited}${Prefix}`
      : Inherited;

/**
 * The groups nested under one, or `never` when it has none.
 */
type NestedOf<Options> = Options extends { groups: infer Nested } ? Nested : never;

/**
 * Every route with its `path` resolved against the group's prefix.
 */
type ResolveRoutes<Prefix extends string, T> = {
    [Key in keyof T]: T[Key] extends { path: infer Path extends AuthoredPath }
        ? Omit<T[Key], 'path'> & { path: ResolvedPath<Prefix, Path> }
        : T[Key] extends object
          ? ResolveRoutes<Prefix, T[Key]>
          : T[Key];
};

/**
 * One group's entry on `k.routes`: callable, and indexable by its nested groups.
 */
export type GroupAccessor<Options, Path extends string, AllPaths extends string, Inherited extends string = ''> = (<
    const T extends AuthoredRoutes<AllPaths>,
>(
    routes: T & PathParamsCheck<ResolveRoutes<ComposedPrefix<Inherited, Options>, T>>
) => ResolveRoutes<ComposedPrefix<Inherited, Options>, T>) &
    ([NestedOf<Options>] extends [never]
        ? unknown
        : {
              readonly [Key in Extract<keyof NestedOf<Options>, string>]: GroupAccessor<
                  NestedOf<Options>[Key],
                  `${Path}.${Key}`,
                  AllPaths,
                  ComposedPrefix<Inherited, Options>
              >;
          });

/**
 * `k.routes`: callable for the root group, indexable by every declared group.
 */
export type GroupRoutes<Declared> = (<const T extends AuthoredRoutes<Extract<GroupPaths<Declared>, string>>>(
    routes: T & PathParamsCheck<T>
) => T) & {
    readonly [Key in Extract<keyof Declared, string>]: GroupAccessor<Declared[Key], Key, Extract<GroupPaths<Declared>, string>>;
};

/**
 * Resolve every route's path against the prefix, in place, and stamp the group.
 */
const applyGroup = (routes: Routes, prefix: string, path: string): void => {
    for (const [key, value] of Object.entries(routes)) {
        if (value === null || typeof value !== 'object') continue;
        const route = value as RouteDefinition & { path: AuthoredPath };
        if (typeof route.method === 'string') {
            assertPathBelowPrefix(prefix, route.path, key);
            route.path = resolvePath(prefix, route.path) as RoutePath;
        } else if ((value as Record<typeof ROUTES_TAG, string>)[ROUTES_TAG] === undefined) {
            // A subtree already stamped belongs to its own group, resolved there.
            applyGroup(value as Routes, prefix, path);
        }
    }
    if (path !== '') {
        (routes as Record<typeof ROUTES_TAG, string>)[ROUTES_TAG] = path;
    }
};

/**
 * Build the accessor tree `k.routes` exposes, eagerly from the declared groups.
 */
export const buildGroupRoutes = <Declared extends Record<string, GroupOptions | string>>(
    groupSet: GroupSet<Declared>,
    validate: (routes: Routes) => void
): GroupRoutes<Declared> => {
    const declare = (prefix: string, path: string) => {
        const fn = (routes: Routes): Routes => {
            applyGroup(routes, prefix, path);
            validate(routes);
            return routes;
        };
        return fn;
    };

    const attach = (target: Record<string, unknown>, childPaths: readonly string[]): void => {
        for (const childPath of childPaths) {
            const child = groupSet.resolved.get(childPath);
            if (child === undefined) continue;
            const key = childPath.slice(childPath.lastIndexOf('.') + 1);
            const accessor = declare(child.pathPrefix, childPath) as unknown as Record<string, unknown>;
            attach(accessor, child.children);
            target[key] = accessor;
        }
    };

    const root = declare('', '') as unknown as Record<string, unknown>;
    attach(root, groupSet.roots);
    return root as unknown as GroupRoutes<Declared>;
};
