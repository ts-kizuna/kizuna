import type { RouteDefinition, Routes } from './types.js';
import type { HandlerArgs, HandlerReturn } from './handler-pipeline.js';
import type { RawResponse } from './raw-response.js';

// Registry-global: adapters read these off the api, and a dual ESM/CJS install
// would otherwise hold two different symbols.
export const PLUGIN_ROUTES_META_KEY: unique symbol = Symbol.for('ts-kizuna.plugin-routes') as symbol as typeof PLUGIN_ROUTES_META_KEY;
export const PLUGIN_SERVERS_META_KEY: unique symbol = Symbol.for('ts-kizuna.plugin-servers') as symbol as typeof PLUGIN_SERVERS_META_KEY;

/**
 * The routes a plugin serves. `api.mount` serves them through the same pipeline
 * as the contract's own, but they never join `contract.routes`, so the client
 * and the generators do not see them.
 */
export type PluginRoutes = Record<string, RouteDefinition>;

/**
 * A plugin's handlers, typed against its routes. A plugin may also answer with
 * {@link raw} when its wire format is not JSON.
 */
export type PluginRouter<R extends PluginRoutes, HandlerContext> = {
    [Key in keyof R]: (
        args: HandlerArgs<R[Key]> & HandlerContext
    ) => Promise<HandlerReturn<R[Key]> | RawResponse> | HandlerReturn<R[Key]> | RawResponse;
};

export interface PluginServer<R extends PluginRoutes, Exports, HandlerContext> {
    router: PluginRouter<R, HandlerContext>;
    exports?: Exports;
}

/**
 * A plugin declares routes and serves them, and never touches the app.
 *
 * `HandlerContext` comes from `new KizunaServer()` rather than being chosen
 * here. Left open, the plugin runs on every adapter; narrowed, it compiles only
 * on the adapters that match.
 */
export interface KizunaPlugin<R extends PluginRoutes = PluginRoutes, Config = void, Exports = unknown, HandlerContext = unknown> {
    name: string;
    routes: R;
    server: (config: Config, api: unknown) => PluginServer<R, Exports, HandlerContext>;
}

/**
 * Build a plugin. Curry it so callers can shape what it declares, and keep
 * those props pure: `routes` reaches the contract, and the contract reaches the
 * browser.
 *
 * @example
 * ```ts
 * export const auditPlugin = (props: AuditPluginProps) =>
 *     createPlugin({
 *         name: 'audit',
 *         routes: {
 *             recent: {
 *                 method: 'GET',
 *                 path: props.path ?? '/audit/recent',
 *                 responses: {
 *                     200: z.array(EntrySchema),
 *                 },
 *             },
 *         },
 *         server: (config: { store: AuditStore }) => ({
 *             router: {
 *                 recent: async () => ({
 *                     status: 200,
 *                     body: await config.store.recent(),
 *                 }),
 *             },
 *         }),
 *     });
 * ```
 */
export const createPlugin = <const R extends PluginRoutes, Config = void, Exports = unknown, HandlerContext = unknown>(
    plugin: KizunaPlugin<R, Config, Exports, HandlerContext>
): KizunaPlugin<R, Config, Exports, HandlerContext> => plugin;

/**
 * Plugins keyed by the name they were installed under on `new Kizuna()`. That
 * key is what `plugins.*` in handler args resolves against.
 */
export type ContractPlugins = Record<string, KizunaPlugin<PluginRoutes, never, unknown, never>>;

/**
 * Every plugin's routes as one tree, keyed by install name, for the adapter to
 * walk as it walks the contract's own.
 */
export const pluginRouteTree = (plugins: ContractPlugins | undefined): Routes => {
    const tree: Record<string, unknown> = {};
    for (const [pluginKey, plugin] of Object.entries(plugins ?? {})) {
        tree[pluginKey] = plugin.routes;
    }
    return tree as Routes;
};

/**
 * The plugin routes `assembleApi` stashed on the api. Empty without plugins, so
 * an adapter can mount it unconditionally.
 */
export const pluginRoutesOf = (api: unknown): Routes =>
    ((api as Record<symbol, unknown>)[PLUGIN_ROUTES_META_KEY] as Routes | undefined) ?? {};

/**
 * Their handlers, keyed to match {@link pluginRoutesOf}.
 */
export const pluginRouterOf = (api: unknown): Record<string, unknown> => {
    const servers = (api as Record<symbol, unknown>)[PLUGIN_SERVERS_META_KEY] as Record<string, { router: unknown }> | undefined;
    const router: Record<string, unknown> = {};
    for (const [pluginKey, served] of Object.entries(servers ?? {})) {
        router[pluginKey] = served.router;
    }
    return router;
};

/**
 * What each plugin exports, for the adapter to pass into the pipeline as the
 * handler args' `plugins`.
 */
export const pluginExportsOf = (api: unknown): Record<string, unknown> => {
    const servers = (api as Record<symbol, unknown>)[PLUGIN_SERVERS_META_KEY] as Record<string, { exports?: unknown }> | undefined;
    const exported: Record<string, unknown> = {};
    for (const [pluginKey, served] of Object.entries(servers ?? {})) {
        if (served.exports !== undefined) exported[pluginKey] = served.exports;
    }
    return exported;
};

export type PluginConfigOf<P> = P extends { server: (config: infer Config, api: never) => unknown } ? Config : never;

export type PluginExportsOf<P> = P extends { server: (...args: never[]) => { exports?: infer Exports } } ? Exports : never;

/**
 * The config `new KizunaApi()` takes per plugin. A plugin whose config is `void`
 * needs nothing, so its key is optional.
 */
export type PluginConfigs<Plugins extends ContractPlugins> = {
    [Key in keyof Plugins as PluginConfigOf<Plugins[Key]> extends void ? never : Key]: PluginConfigOf<Plugins[Key]>;
} & {
    [Key in keyof Plugins as PluginConfigOf<Plugins[Key]> extends void ? Key : never]?: undefined;
};

export type PluginExportValues<Plugins extends ContractPlugins> = {
    [Key in keyof Plugins]: PluginExportsOf<Plugins[Key]>;
};

/**
 * The `plugins` handler argument, or nothing when no plugins are installed, so
 * handler args are unchanged without them.
 */
export type PluginArgs<Plugins extends ContractPlugins> = string extends keyof Plugins
    ? unknown
    : {
          plugins: PluginExportValues<Plugins>;
      };

/**
 * Call each plugin's server half. Deferred until the api object exists, because
 * a plugin receives it.
 */
export const resolvePluginServers = (
    plugins: ContractPlugins | undefined,
    configs: Record<string, unknown> | undefined,
    api: unknown
): Record<string, { router: unknown; exports?: unknown }> => {
    const resolved: Record<string, { router: unknown; exports?: unknown }> = {};
    for (const [pluginKey, plugin] of Object.entries(plugins ?? {})) {
        resolved[pluginKey] = plugin.server(configs?.[pluginKey] as never, api);
    }
    return resolved;
};
