import { parsePath } from './path-params.js';
import { flattenRoutes } from './handler-pipeline.js';
import type { Routes } from './types.js';

/**
 * One thing claiming one method and path.
 */
export interface PathClaim {
    /**
     * What claims it, worded as the error should read.
     */
    kind: string;
    /**
     * The key it is declared under, like `users.createUser`.
     */
    key: string;
    method: string;
    path: string;
}

// `/users/:id` and `/users/:userId` are one endpoint at runtime.
const signatureOf = ({ method, path }: PathClaim): string => {
    const { segments } = parsePath(path);
    return `${method}:${segments.map((segment) => (segment.kind === 'param' ? ':*' : segment.value)).join('')}`;
};

/**
 * Throw when two things claim one method and path.
 */
export const assertNoPathCollisions = (claims: readonly PathClaim[]): void => {
    const claimed = new Map<string, PathClaim>();
    for (const claim of claims) {
        const signature = signatureOf(claim);
        const conflict = claimed.get(signature);
        if (conflict) {
            throw new Error(
                `${claim.kind} "${claim.key}" (${claim.method} ${claim.path}) collides with ${conflict.kind.toLowerCase()} "${conflict.key}", which already serves it.`
            );
        }
        claimed.set(signature, claim);
    }
};

export const routeClaims = (routes: Routes | undefined, kind = 'Route'): PathClaim[] =>
    routes === undefined
        ? []
        : flattenRoutes(routes).map(({ routeKey, route }) => ({
              kind,
              key: routeKey,
              method: route.method,
              path: route.path,
          }));
