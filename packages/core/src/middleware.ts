import type { Routes, RouteDefinition } from './types.js';

/**
 * A routes-shaped structure that maps route keys to middleware arrays.
 *
 * - An array on a leaf key applies that middleware to the single route.
 * - An array on a group key applies that middleware to every route in the group.
 * - A nested object on a group key allows per-route middleware within the group.
 * - A `'*'` key in a nested group provides default middleware for routes not explicitly listed.
 *
 * Every top-level group must be present — use `[]` for public routes. Inside a
 * group, individual route keys are optional because `'*'` provides the default.
 *
 * @deprecated Define auth with identities + the contract's `auth` map and pass
 * `guards` to `createApi`. See /docs/auth.
 */
export type MiddlewareMap<T extends Routes, M> = {
    [K in keyof T as K extends symbol ? never : K]: T[K] extends RouteDefinition
        ? M[]
        : M[] | (MiddlewareGroupMap<Extract<T[K], Routes>, M> & { '*'?: M[] });
};

type MiddlewareGroupMap<T extends Routes, M> = {
    [K in keyof T as K extends symbol ? never : K]?: T[K] extends RouteDefinition
        ? M[]
        : M[] | (MiddlewareGroupMap<Extract<T[K], Routes>, M> & { '*'?: M[] });
};

/**
 * Resolve the middleware array for a given route key by walking the map.
 *
 * If a group key maps to an array, that array applies to all routes in the group.
 * If a group key maps to a nested object, the resolver descends to find the specific route.
 */
export function resolveMiddleware<M>(routeKey: string, map: MiddlewareMap<Routes, M> | undefined): M[] {
    if (!map) return [];

    const segments = routeKey.split('.');
    let current: unknown = map;

    for (const segment of segments) {
        if (!current || typeof current !== 'object' || Array.isArray(current)) {
            break;
        }
        const value = (current as Record<string, unknown>)[segment];
        if (value === undefined) {
            const fallback = (current as Record<string, unknown>)['*'];
            if (Array.isArray(fallback)) {
                return fallback as M[];
            }
            return [];
        }
        if (Array.isArray(value)) {
            return value as M[];
        }
        current = value;
    }

    return [];
}
