import { z } from 'zod';
import { createPlugin, type RoutePath } from '@ts-kizuna/core/plugin';
import type { McpServerOptions } from './mcp-server.js';

export interface McpPluginProps {
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
     * Predicate to filter which routes become MCP tools. Return `false` to
     * exclude a route. By default, `multipart/form-data` and
     * `application/x-www-form-urlencoded` routes are excluded.
     */
    routeFilter?: McpServerOptions['routeFilter'];
}

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
 * export const k = new Kizuna({
 *     tags,
 *     identities,
 *     plugins: {
 *         mcp: mcpPlugin({
 *             name: 'My API',
 *         }),
 *     },
 * });
 * ```
 */
export const mcpPlugin = (props: McpPluginProps = {}) =>
    createPlugin({
        name: 'mcp',
        serverModule: '@ts-kizuna/mcp/server',
        routes: {
            endpoint: {
                method: 'POST',
                path: props.path ?? '/mcp',
                summary: 'MCP (Model Context Protocol) endpoint',
                body: z.unknown(),
                responses: {
                    200: z.unknown(),
                },
            },
        },
        props,
    });
