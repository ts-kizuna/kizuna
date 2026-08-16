import type { HandlerArgs, HandlerReturn } from '@ts-kizuna/contract/internal';
import type { RawResponse } from './raw-response.js';
import { type ContractPlugins, type PluginDeclaration, type PluginExportsOf, type PluginPropsOf, type PluginRoutes, type PluginRoutesOf } from './adapter.js';
import { PLUGIN_ROUTES_META_KEY, PLUGIN_SERVERS_META_KEY } from '@ts-kizuna/contract/internal';
import type { Routes } from '@ts-kizuna/contract/internal';

/**
 * A plugin's handlers, typed against its routes. A plugin may also answer with
 * {@link rawResponse} when its wire format is not JSON.
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
 * A plugin's serve-time half: the code behind a {@link PluginDeclaration}. Only
 * the server app imports it, so it may import anything.
 */
export interface PluginImplementation<Props = unknown, R extends PluginRoutes = PluginRoutes, Exports = unknown, HandlerContext = unknown> {
    serve: (props: Props, api: unknown) => PluginServer<R, Exports, HandlerContext>;
}

/**
 * The declaration a plugin's factory produces, or the declaration itself.
 */
type DeclarationOf<Source> = Source extends (...args: never[]) => infer Produced
    ? Produced extends PluginDeclaration
        ? Produced
        : never
    : Source extends PluginDeclaration
      ? Source
      : never;

/**
 * Implement a declared plugin. The first argument is read for its type only,
 * never called: it types the router against the declared routes and the exports
 * against what the declaration promised. `props` comes from the contract;
 * anything live is the factory's own argument.
 *
 * `HandlerContext` comes from the adapter rather than being chosen here. Left
 * open, the plugin runs on every adapter; narrowed, it compiles only on the
 * adapters that match.
 *
 * @example
 * ```ts
 * export interface AuditExports {
 *     record: (routeKey: string) => void;
 * }
 *
 * export const auditPluginServer = (config: { store: AuditStore }) =>
 *     implementPlugin(auditPlugin, ({ props }) => ({
 *         router: {
 *             recent: async () => ({
 *                 status: 200 as const,
 *                 body: await config.store.recent(props.limit),
 *             }),
 *         },
 *         exports: {
 *             record: (routeKey: string) => config.store.write(routeKey),
 *         },
 *     }));
 * ```
 */
export const implementPlugin = <Source, HandlerContext = unknown>(
    _declaration: Source,
    serve: (context: {
        props: PluginPropsOf<DeclarationOf<Source>>;
        api: unknown;
    }) => PluginServer<PluginRoutesOf<DeclarationOf<Source>>, PluginExportsOf<DeclarationOf<Source>>, HandlerContext>
): PluginImplementation<
    PluginPropsOf<DeclarationOf<Source>>,
    PluginRoutesOf<DeclarationOf<Source>>,
    PluginExportsOf<DeclarationOf<Source>>,
    HandlerContext
> => ({
    serve: (props, api) =>
        serve({
            props,
            api,
        }),
});

/**
 * The server half `server.api` takes per plugin, keyed by install name.
 */
export type PluginImplementations<Plugins extends ContractPlugins, HandlerContext> = {
    [Key in keyof Plugins]: PluginImplementation<
        PluginPropsOf<Plugins[Key]>,
        PluginRoutesOf<Plugins[Key]>,
        PluginExportsOf<Plugins[Key]>,
        HandlerContext
    >;
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

/**
 * Join every declaration to its server half. Deferred until the api object
 * exists, because an implementation receives it.
 */
export const resolvePluginServers = (
    plugins: ContractPlugins | undefined,
    implementations: Record<string, PluginImplementation> | undefined,
    api: unknown
): Record<string, { router: Record<string, unknown>; exports?: unknown }> => {
    const resolved: Record<string, { router: Record<string, unknown>; exports?: unknown }> = {};
    for (const [pluginKey, declaration] of Object.entries(plugins ?? {})) {
        const implementation = implementations?.[pluginKey];
        if (!implementation) {
            throw new Error(
                `Plugin '${pluginKey}' is declared on the contract but has no server. Import its server half from '${declaration.serverModule}' and pass it to server.api under plugins.${pluginKey}.`
            );
        }
        const served = implementation.serve(declaration.props as never, api) as {
            router: Record<string, unknown>;
            exports?: unknown;
        };
        for (const routeKey of Object.keys(declaration.routes)) {
            if (routeKey in served.router) continue;
            throw new Error(
                `Plugin '${pluginKey}' declares the route '${routeKey}' but the server half from '${declaration.serverModule}' does not handle it.`
            );
        }
        resolved[pluginKey] = served;
    }
    return resolved;
};
