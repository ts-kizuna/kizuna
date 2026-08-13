import { z } from 'zod';
import type { Permission } from './permission.js';
import type { RouteDefinition, Routes } from './types.js';
import type { Router } from './handler-pipeline.js';

type Can = Record<string, (record?: unknown) => Promise<boolean>>;

export const DEFAULT_PERMISSIONS_PATH = '/permissions';

/**
 * Settings for the endpoint that reports the caller's resolved permissions.
 * Declared on `new Kizuna()` under `permissions`.
 */
export interface PermissionsConfig {
    /**
     * Where the endpoint is served.
     *
     * @default '/permissions'
     */
    path?: string;
    /**
     * The identity a caller must present. Omit for a public endpoint, which only
     * makes sense when no rule reads `auth`.
     */
    identity?: string;
}

/**
 * What `server.api` stamps on the api object so an adapter can mount the
 * endpoint.
 */
export interface PermissionsMeta extends PermissionsConfig {
    declared: Record<string, Permission>;
}

export const PERMISSIONS_ROUTE_KEY = 'kizuna:permissions';

/**
 * Every permission applying to no particular record, keyed by name. One that
 * applies to a record resolves to a predicate, which cannot cross a wire, so it
 * stays on the server.
 */
const ResolvedPermissionsSchema = z.record(z.string(), z.boolean());

export const permissionsEndpointPath = (meta: PermissionsMeta): string => meta.path ?? DEFAULT_PERMISSIONS_PATH;

export const permissionsEndpointRoute = (meta: PermissionsMeta): RouteDefinition => ({
    method: 'GET',
    path: permissionsEndpointPath(meta) as `/${string}`,
    summary: "The caller's resolved permissions",
    description:
        'Every rule that can be answered without an entity, keyed by policy then action. ' +
        'Rules that depend on a specific entity are not included, since a function cannot cross the wire.',
    security: meta.identity === undefined ? [] : [meta.identity],
    responses: {
        200: ResolvedPermissionsSchema,
    },
});

export const permissionsEndpointRoutes = (meta: PermissionsMeta): Routes => ({
    [PERMISSIONS_ROUTE_KEY]: permissionsEndpointRoute(meta),
});

/**
 * The endpoint's handler. It answers with `can` rather than reaching for the
 * resolvers itself, so the same laziness and memoization apply: a policy resolves
 * once, and only because this route asks about it.
 */
export const permissionsEndpointHandler =
    <HandlerContext>(meta: PermissionsMeta) =>
    async ({ can }: { can: Can }) => {
        const resolved: Record<string, boolean> = {};
        for (const [name, permission] of Object.entries(meta.declared)) {
            if (permission.appliesTo !== undefined) continue;
            resolved[name] = await can[name]!();
        }
        return {
            status: 200 as const,
            body: resolved,
        };
    };

export const permissionsEndpointRouter = <HandlerContext>(meta: PermissionsMeta): Router<Routes, HandlerContext> =>
    ({
        [PERMISSIONS_ROUTE_KEY]: permissionsEndpointHandler<HandlerContext>(meta),
    }) as unknown as Router<Routes, HandlerContext>;

/**
 * Throws when the endpoint's path is one a contract route already serves.
 */
export const assertNoPermissionsEndpointCollision = (meta: PermissionsMeta, routePaths: Map<string, string>): void => {
    const path = permissionsEndpointPath(meta);
    const conflict = routePaths.get(`GET:${path}`);
    if (conflict) {
        throw new Error(
            `The permissions endpoint path '${path}' is already served by route '${conflict}'. ` +
                "Move it with `permissions: { path: '...' }` on `new Kizuna()`."
        );
    }
};
