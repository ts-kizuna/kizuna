import type { ApiWithRouter } from './adapter.js';

export const PLUGINS_META: unique symbol = Symbol('ts-kizuna.plugins');

/**
 * Something handed your whole contract, that builds something out of it and
 * serves it from your app. `mcpPlugin()` is one: it reads every route and
 * exposes each as a tool an AI assistant can call.
 *
 * `api.mount` runs each plugin once the contract's routes are registered,
 * passing the app to register on and the api to read. `app` is the framework's
 * own app object, so plugins are written per adapter: import one from the
 * subpath matching yours.
 *
 * @example
 * ```ts
 * const routeIndexPlugin = (): KizunaPlugin<App> => ({
 *     name: 'route-index',
 *     mount: (app, api) => {
 *         const routes = flattenRoutes(api.routes);
 *         app.get('/_routes', (_req, res) => res.json(routes));
 *     },
 * });
 * ```
 */
export interface KizunaPlugin<App = unknown> {
    name: string;
    mount: (app: App, api: ApiWithRouter) => void | Promise<void>;
}

/**
 * Run every plugin registered on the api. Adapters call this from `mount` after
 * the contract's routes are registered.
 */
export const mountPlugins = async (api: ApiWithRouter, app: unknown): Promise<void> => {
    const plugins = (api as { [PLUGINS_META]?: readonly KizunaPlugin<unknown>[] })[PLUGINS_META];
    if (!plugins) return;
    for (const plugin of plugins) {
        await plugin.mount(app, api);
    }
};
