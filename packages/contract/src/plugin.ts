import type { RouteDefinition, Routes } from './types.js';

export type { RoutePath } from './types.js';

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
 * A plugin's contract-time half: what it declares, as data. `server.api({ plugins })`
 * joins it to the server half named in `serverModule`.
 */
export interface PluginDeclaration<R extends PluginRoutes = PluginRoutes, Props = unknown, Exports = unknown> {
    name: string;
    /**
     * Named in the error when a contract declares a plugin the server never
     * implemented.
     */
    serverModule: string;
    routes: R;
    /**
     * Passed to the server half, so the app never restates it.
     */
    props: Props;
    /**
     * Never present at runtime: it carries what the server half exports, so
     * handlers can type `plugins.<name>` from the contract alone.
     */
    readonly exportsType?: Exports;
}

/**
 * What {@link createPlugin} takes.
 */
export interface PluginDefinition<R extends PluginRoutes, Props> {
    name: string;
    serverModule: string;
    routes: R;
    props?: Props;
}

interface CreatePlugin {
    <const R extends PluginRoutes, const Props = undefined>(definition: PluginDefinition<R, Props>): PluginDeclaration<R, Props, unknown>;
    /**
     * Curried, for a plugin whose server half exports something to handlers.
     */
    <Exports>(): <const R extends PluginRoutes, const Props = undefined>(
        definition: PluginDefinition<R, Props>
    ) => PluginDeclaration<R, Props, Exports>;
}

const declare = <const R extends PluginRoutes, const Props>(definition: PluginDefinition<R, Props>): PluginDeclaration<R, Props> => ({
    name: definition.name,
    serverModule: definition.serverModule,
    routes: definition.routes,
    props: definition.props as Props,
});

/**
 * Declare a plugin's contract-time half: its routes and its props, as data.
 * Everything live goes in the server half, built with `implementPlugin`.
 *
 * @example
 * ```ts
 * import type { AuditExports } from '@ts-kizuna/server';
 *
 * export const auditPlugin = (props: AuditPluginProps = {}) =>
 *     createPlugin<AuditExports>()({
 *         name: 'audit',
 *         serverModule: '@ts-kizuna/audit/server',
 *         routes: {
 *             recent: {
 *                 method: 'GET',
 *                 path: props.path ?? '/audit/recent',
 *                 responses: {
 *                     200: z.array(EntrySchema),
 *                 },
 *             },
 *         },
 *         props,
 *     });
 * ```
 */
export const createPlugin = ((definition?: PluginDefinition<PluginRoutes, unknown>) =>
    definition === undefined ? declare : declare(definition)) as CreatePlugin;

/**
 * Plugins keyed by the name they were installed under on `new Kizuna()`. That
 * key is what `plugins.*` in handler args resolves against.
 */
export type ContractPlugins = Record<string, PluginDeclaration<PluginRoutes, unknown, unknown>>;

export type PluginRoutesOf<Declaration> = Declaration extends PluginDeclaration<infer R, unknown, unknown> ? R : never;

export type PluginPropsOf<Declaration> = Declaration extends PluginDeclaration<PluginRoutes, infer Props, unknown> ? Props : never;

export type PluginExportsOf<Declaration> = Declaration extends PluginDeclaration<PluginRoutes, unknown, infer Exports> ? Exports : never;

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
