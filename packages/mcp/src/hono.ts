import type { Context } from 'hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Routes } from '@ts-kizuna/core';
import { type ApiWithRouter, headersToObject } from '@ts-kizuna/core/adapter';
import { createMcpServer, type McpServerOptions } from './server.js';

interface AppLike {
    post(path: string, handler: (c: Context) => Response | Promise<Response>): unknown;
    get(path: string, handler: (c: Context) => Response | Promise<Response>): unknown;
    delete(path: string, handler: (c: Context) => Response | Promise<Response>): unknown;
}

export interface McpEndpointOptions {
    /**
     * Path where the MCP endpoint is mounted.
     *
     * @default '/mcp'
     */
    path?: string;

    /**
     * Human-readable name for the MCP server.
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
 * Mount an MCP endpoint on a Hono app. Each route becomes an MCP tool; calling
 * the tool invokes the api's handler for that route.
 *
 * @example
 * ```ts
 * const app = new Hono();
 * createMcpEndpoint(api, app);
 * ```
 */
export const createMcpEndpoint = (api: Routes & ApiWithRouter, app: AppLike, options?: McpEndpointOptions): void => {
    const mountPath = options?.path ?? '/mcp';

    app.post(mountPath, async (c: Context) => {
        const server = createMcpServer(api, {
            ...options,
            handlerContext: {
                c,
            },
            credentialHeaders: headersToObject(c.req.raw.headers),
        });
        const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
        });
        await server.connect(transport);
        return transport.handleRequest(c.req.raw);
    });

    app.get(mountPath, (c: Context) => {
        return c.json(
            {
                jsonrpc: '2.0',
                error: {
                    code: -32000,
                    message: 'Method not allowed. Use POST for MCP requests.',
                },
                id: null,
            },
            405
        );
    });

    app.delete(mountPath, (c: Context) => {
        return c.json(
            {
                jsonrpc: '2.0',
                error: {
                    code: -32000,
                    message: 'Method not allowed. Stateless server does not support session termination.',
                },
                id: null,
            },
            405
        );
    });
};
