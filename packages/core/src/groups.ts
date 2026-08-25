import type { RoutePath } from './types.js';

export interface GroupOptions {
    /**
     * The OpenAPI tag name. Unique across the set.
     */
    title: string;
    description?: string;
    externalDocs?: {
        url: string;
        description?: string;
    };
    /**
     * Prepended to every route `path` in this group, after the prefixes of the groups it sits in.
     * `{ absolute }` starts from the root instead.
     */
    pathPrefix?: RoutePath | { absolute: RoutePath };
    /**
     * The groups nested under this one.
     */
    groups?: Record<string, GroupOptions | string>;
}

/**
 * A declared group with its place in the tree resolved.
 */
export interface ResolvedGroup {
    readonly options: GroupOptions;
    /**
     * Dotted paths from the outermost group to this one, inclusive.
     */
    readonly lineage: readonly string[];
    /**
     * Dotted paths of the groups directly under this one.
     */
    readonly children: readonly string[];
    /**
     * The prefix routes in this group resolve against, composed down the lineage.
     */
    readonly pathPrefix: string;
}

/**
 * A set of groups created with `Kizuna.groups`.
 */
export interface GroupSet<Declared extends Record<string, GroupOptions | string> = Record<string, GroupOptions | string>> {
    readonly __brand: 'GroupSet';
    /**
     * The tree as written, carried for its type.
     */
    readonly declared: Declared;
    /**
     * Every group by dotted path.
     */
    readonly groups: Record<Extract<GroupPaths<Declared>, string>, GroupOptions>;
    readonly resolved: ReadonlyMap<string, ResolvedGroup>;
    /**
     * Dotted paths of the outermost groups.
     */
    readonly roots: readonly string[];
}

/**
 * The dotted group paths a {@link GroupSet} declares.
 */
export type GroupPathsOf<Set extends GroupSet> = Set extends GroupSet<infer Declared> ? Extract<GroupPaths<Declared>, string> : never;

export const isGroupSet = (value: unknown): value is GroupSet =>
    typeof value === 'object' && value !== null && '__brand' in value && (value as GroupSet).__brand === 'GroupSet';

/**
 * The group set a `new Kizuna()` without one stands on.
 */
export const emptyGroupSet = <Declared extends Record<string, GroupOptions | string>>(): GroupSet<Declared> => ({
    __brand: 'GroupSet',
    declared: {} as Declared,
    groups: {} as GroupSet<Declared>['groups'],
    resolved: new Map(),
    roots: [],
});

/**
 * Flatten the declared tree, a group landing ahead of its nested groups.
 */
const flatten = (
    declared: Record<string, GroupOptions | string>,
    ancestors: readonly string[],
    resolved: Map<string, ResolvedGroup>,
    flat: Record<string, GroupOptions>,
    inheritedPrefix = ''
): string[] => {
    const paths: string[] = [];
    const parentPath = ancestors[ancestors.length - 1];
    for (const [key, value] of Object.entries(declared)) {
        const path = parentPath === undefined ? key : `${parentPath}.${key}`;
        const options = typeof value === 'string' ? { title: value } : value;
        const nested = options.groups ?? {};
        const lineage = [...ancestors, path];
        const own = ownPrefix(options.pathPrefix);
        if (own.segment !== '') assertUsablePrefix(path, own.segment);
        flat[path] = options;
        resolved.set(path, {
            options,
            lineage,
            children: Object.keys(nested).map((child) => `${path}.${child}`),
            pathPrefix: own.absolute ? own.segment : `${inheritedPrefix}${own.segment}`,
        });
        flatten(nested, lineage, resolved, flat, own.absolute ? own.segment : `${inheritedPrefix}${own.segment}`);
        paths.push(path);
    }
    return paths;
};

/**
 * A group's own prefix segment, and whether it starts from the root.
 */
const ownPrefix = (declared: GroupOptions['pathPrefix']): { segment: string; absolute: boolean } => {
    if (declared === undefined) return { segment: '', absolute: false };
    if (typeof declared === 'string') return { segment: declared, absolute: false };
    return { segment: declared.absolute, absolute: true };
};

/**
 * Throw unless a prefix joins to a route path without changing which resource it names.
 */
const assertUsablePrefix = (path: string, prefix: string): void => {
    if (!prefix.startsWith('/')) {
        throw new Error(`The group "${path}" has the prefix "${prefix}", which must start with "/".`);
    }
    if (prefix === '/') {
        throw new Error(`The group "${path}" is prefixed "/", which adds nothing. Leave pathPrefix off.`);
    }
    if (prefix.endsWith('/')) {
        throw new Error(`The group "${path}" has the prefix "${prefix}", which must not end with "/".`);
    }
};

/**
 * Throw on a title two groups share, which the document would silently merge.
 */
const assertUniqueTitles = (flat: Record<string, GroupOptions>): void => {
    const owners = new Map<string, string>();
    for (const [path, options] of Object.entries(flat)) {
        const owner = owners.get(options.title);
        if (owner !== undefined) {
            throw new Error(`The groups "${owner}" and "${path}" share the title "${options.title}". A title names one group.`);
        }
        owners.set(options.title, path);
    }
};

/**
 * Declare the groups routes are organised into. Nesting a group nests the group.
 *
 * A value may be {@link GroupOptions} or a string, shorthand for `{ title }`.
 *
 * @example
 * const groups = Kizuna.groups({
 *     workspace: {
 *         title: 'Workspace',
 *         pathPrefix: '/workspace',
 *         groups: {
 *             members: {
 *                 title: 'Members',
 *                 pathPrefix: '/members',
 *             },
 *         },
 *     },
 *     health: 'Health',
 * });
 */
export const createGroups = <const T extends Record<string, GroupOptions | string>>(groups: T): GroupSet<T> => {
    const resolved = new Map<string, ResolvedGroup>();
    const flat: Record<string, GroupOptions> = {};
    const roots = flatten(groups, [], resolved, flat);
    assertUniqueTitles(flat);
    return {
        __brand: 'GroupSet',
        declared: groups,
        groups: flat as GroupSet<T>['groups'],
        resolved,
        roots,
    };
};

/**
 * Every group a `Kizuna.groups` input declares, as its dotted path.
 */
export type GroupPaths<T> = {
    [Key in Extract<keyof T, string>]:
        | Key
        | (T[Key] extends { groups: infer Nested } ? `${Key}.${Extract<GroupPaths<Nested>, string>}` : never);
}[Extract<keyof T, string>];
