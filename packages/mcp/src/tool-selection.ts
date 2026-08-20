import type { FlattenedRoute } from '@ts-kizuna/core/adapter';
import type { RouteDefinition, Routes } from '@ts-kizuna/core';
import { isSafeMethod } from './method.js';

/**
 * Whether a route, or every route under a group, becomes a tool. A group takes
 * `'*'` for its default, then names the routes that differ.
 */
export type ToolEntry<GroupOrRoute> = GroupOrRoute extends RouteDefinition
    ? boolean
    :
          | boolean
          | ({
                '*'?: boolean;
            } & {
                [Key in keyof GroupOrRoute & string]?: ToolEntry<GroupOrRoute[Key]>;
            });

/**
 * Which routes become tools, keyed by the route tree. A route the map never
 * mentions is a tool, so a map only says what differs from that.
 */
export type ToolMap<R extends Routes = Routes> = {
    [Key in keyof R & string]?: ToolEntry<R[Key]>;
};

/**
 * The deepest explicit answer wins, then the nearest `'*'`.
 */
const isExposed = (map: ToolMap | undefined, routeKey: string): boolean => {
    if (map === undefined) return true;

    let node: unknown = map;
    let fallback = true;

    for (const segment of routeKey.split('.')) {
        if (typeof node === 'boolean') return node;
        if (node === null || typeof node !== 'object') return fallback;

        const level = node as Record<string, unknown>;
        if (typeof level['*'] === 'boolean') fallback = level['*'];
        if (!(segment in level)) return fallback;
        node = level[segment];
    }

    return typeof node === 'boolean' ? node : fallback;
};

/**
 * Tool input is JSON, so a route that reads a form body has nothing to receive
 * it. This holds whatever the map says.
 */
const takesJsonInput = (route: RouteDefinition): boolean => route.contentType === undefined || route.contentType === 'application/json';

export interface ToolSelection<R extends Routes = Routes> {
    /**
     * Which routes become tools. Keys are checked against the routes passed
     * alongside, so a name the routes do not have is a type error.
     */
    tools?: ToolMap<R>;

    /**
     * Keep only the methods RFC 9110 calls safe, so no tool an assistant calls
     * can change data.
     *
     * @default false
     */
    onlyReadOnly?: boolean;
}

export const selectToolRoutes = (routes: FlattenedRoute[], selection: ToolSelection | undefined): FlattenedRoute[] =>
    routes.filter(({ route, routeKey }) => {
        if (!takesJsonInput(route)) return false;
        if (selection?.onlyReadOnly && !isSafeMethod(route.method)) return false;
        return isExposed(selection?.tools, routeKey);
    });
