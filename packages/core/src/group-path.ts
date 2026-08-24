import type { AuthoredPath, RoutePath } from './types.js';

export type { AuthoredPath };

/**
 * A route's group prefix followed by its own path.
 *
 * `'/'` resolves to the prefix unchanged: `/users`, not `/users/`, which RFC 3986 makes a different resource.
 */
export type ResolvedPath<Prefix extends string, Path extends AuthoredPath> = Path extends {
    absolute: infer Absolute extends RoutePath;
}
    ? Absolute
    : Path extends '/'
      ? Prefix extends ''
          ? '/'
          : Prefix
      : Path extends string
        ? `${Prefix}${Path}`
        : never;

/**
 * Type guard for the object form of {@link AuthoredPath}.
 */
export const isAbsolutePath = (path: AuthoredPath): path is { absolute: RoutePath } =>
    typeof path === 'object' && path !== null && 'absolute' in path;

/**
 * The runtime half of {@link ResolvedPath}.
 */
export const resolvePath = (prefix: string, path: AuthoredPath): RoutePath => {
    if (isAbsolutePath(path)) return path.absolute;
    if (prefix === '') return path;
    return (path === '/' ? prefix : `${prefix}${path}`) as RoutePath;
};

/**
 * Throw when a route path already carries its group's prefix, which would repeat it.
 */
export const assertPathBelowPrefix = (prefix: string, path: AuthoredPath, routeKey: string): void => {
    if (prefix === '' || isAbsolutePath(path)) return;
    if (path === prefix || path.startsWith(`${prefix}/`)) {
        throw new Error(
            `Route "${routeKey}" has the path "${path}", which already starts with its group's prefix "${prefix}". ` +
                `Write the part below it, or use path: { absolute: '${path}' }.`
        );
    }
};
