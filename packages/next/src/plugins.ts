export type { KizunaPlugin } from '@ts-kizuna/core/adapter';

import type { NextRequest } from 'next/server';

export type PluginHandler = (request: NextRequest) => Response | Promise<Response>;

/**
 * What a plugin registers on under Next.js. The other adapters hand plugins the
 * framework's app object; Next has none, so `mount` supplies this instead.
 *
 * Paths registered here are served by the catch-all route file that already
 * serves the contract, so they resolve under the `basePath` given to `mount`.
 */
export interface PluginHost {
    get(path: string, handler: PluginHandler): void;
    post(path: string, handler: PluginHandler): void;
    put(path: string, handler: PluginHandler): void;
    patch(path: string, handler: PluginHandler): void;
    delete(path: string, handler: PluginHandler): void;
}

/**
 * Collect the plugins' paths, and look them up per request. `mount` checks
 * these before falling through to the contract's own routes.
 */
export const createPluginHost = (
    basePath?: string
): {
    host: PluginHost;
    match: (method: string, pathname: string) => PluginHandler | undefined;
} => {
    const registered = new Map<string, PluginHandler>();
    const prefix = basePath?.replace(/\/$/, '') ?? '';
    const register = (method: string) => (path: string, handler: PluginHandler) => {
        registered.set(`${method} ${prefix}${path.startsWith('/') ? path : `/${path}`}`, handler);
    };
    return {
        host: {
            get: register('GET'),
            post: register('POST'),
            put: register('PUT'),
            patch: register('PATCH'),
            delete: register('DELETE'),
        },
        match: (method, pathname) => registered.get(`${method} ${pathname.replace(/(.)\/$/, '$1')}`),
    };
};
