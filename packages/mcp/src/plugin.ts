import { z } from 'zod';
import { createPlugin, type RoutePath } from '@ts-kizuna/core/plugin';
import { ProtectedResourceMetadataSchema } from '@ts-kizuna/core/schemas';
import type { Routes } from '@ts-kizuna/core';
import type { ToolSelection } from './tool-selection.js';
import { protectedResourceMetadataPath, type McpOAuthProps } from './oauth.js';

export interface McpPluginProps<R extends Routes = Routes> extends ToolSelection<R> {
    /**
     * Path the endpoint is served from.
     *
     * @default '/mcp'
     */
    path?: RoutePath;

    /**
     * Human-readable name shown to AI assistants.
     *
     * @default 'MCP Server'
     */
    name?: string;

    /**
     * Semantic version string (e.g. "1.0.0").
     *
     * @default '1.0.0'
     */
    version?: string;

    /**
     * Guidance for the model, appended to the overview built from the
     * contract's tags.
     */
    instructions?: string;

    /**
     * Serve the endpoint as an OAuth 2.1 resource server, per the MCP
     * authorization specification: RFC 9728 metadata on a well-known route,
     * and HTTP `401`/`403` challenges built from the named identity.
     */
    oauth?: McpOAuthProps;
}

const declare = (props: McpPluginProps) => {
    const endpointPath = props.path ?? '/mcp';
    return createPlugin({
        name: 'mcp',
        serverModule: '@ts-kizuna/mcp/server',
        routes: {
            endpoint: {
                method: 'POST',
                path: endpointPath,
                summary: 'MCP (Model Context Protocol) endpoint',
                body: z.unknown(),
                responses: {
                    200: z.unknown(),
                },
            },
            ...(props.oauth === undefined
                ? {}
                : {
                      protectedResourceMetadata: {
                          method: 'GET',
                          path: protectedResourceMetadataPath(endpointPath),
                          summary: 'OAuth protected resource metadata',
                          responses: {
                              200: ProtectedResourceMetadataSchema,
                          },
                      },
                  }),
        },
        props,
    });
};

/**
 * Let AI assistants use the API. Serves an MCP (Model Context Protocol)
 * endpoint where every route is a tool an assistant can discover and call,
 * behind the same guards as the HTTP endpoints.
 *
 * The endpoint is an ordinary kizuna route, so `api.mount` serves it on any
 * adapter, and it stays out of `contract.routes` so the client and the
 * generators do not see it.
 *
 * Pass `mcpPluginServer()` from `@ts-kizuna/mcp/server` to `server.api({ plugins })`
 * to serve it.
 *
 * @example
 * ```ts
 * export const contract = k.contract({
 *     routes,
 *     plugins: {
 *         mcp: mcpPlugin({
 *             name: 'My API',
 *         }),
 *     },
 * });
 * ```
 */
export function mcpPlugin(props?: McpPluginProps): ReturnType<typeof declare>;

/**
 * Pass the contract's routes to have `tools` checked against them, so a name
 * the routes do not have is a compile error. Write `plugins` as a function and
 * `k.contract` hands the routes over.
 *
 * @example
 * ```ts
 * export const contract = k.contract({
 *     routes,
 *     plugins: ({ routes }) => ({
 *         mcp: mcpPlugin(routes, {
 *             name: 'My API',
 *             tools: {
 *                 health: false,
 *             },
 *         }),
 *     }),
 * });
 * ```
 */
export function mcpPlugin<const R extends Routes>(routes: R, props?: McpPluginProps<R>): ReturnType<typeof declare>;

export function mcpPlugin(routesOrProps: Routes | McpPluginProps = {}, props?: McpPluginProps): ReturnType<typeof declare> {
    return declare(props ?? (routesOrProps as McpPluginProps));
}
