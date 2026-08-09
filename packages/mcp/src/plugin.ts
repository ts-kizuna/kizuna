import { createMcpHandler } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { adapterContextOf, createPlugin, raw, type ApiWithRouter } from '@ts-kizuna/core/adapter';
import { createMcpServer, type McpServerOptions } from './server.js';

export interface McpPluginProps {
    /**
     * Path the endpoint is served from.
     *
     * @default '/mcp'
     */
    path?: `/${string}`;

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

type HandlerArgs = {
    body: unknown;
    headers: Record<string, string | string[] | undefined>;
    [key: string]: unknown;
};

const toHeaders = (headers: HandlerArgs['headers']): Headers => {
    const built = new Headers();
    for (const [name, value] of Object.entries(headers)) {
        if (value === undefined) continue;
        for (const entry of Array.isArray(value) ? value : [value]) built.append(name, entry);
    }
    return built;
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
        server: (_config: void, api: unknown) => ({
            router: {
                endpoint: async (args: HandlerArgs) => {
                    const handler = createMcpHandler(() =>
                        createMcpServer(api as ApiWithRouter, {
                            ...props,
                            handlerContext: adapterContextOf(args),
                            credentialHeaders: args.headers,
                        })
                    );

                    // Rebuilt from the inputs the pipeline already parsed, so
                    // the handler gets a web request on every adapter.
                    return raw(
                        await handler.fetch(
                            new Request('http://mcp.local/', {
                                method: 'POST',
                                headers: toHeaders(args.headers),
                                body: JSON.stringify(args.body),
                            })
                        )
                    );
                },
            },
        }),
    });
