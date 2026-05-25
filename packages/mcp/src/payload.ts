import type { Config, Endpoint, PayloadRequest } from 'payload';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Contract } from '@ts-kizuna/core';
import { type ApiWithRouter } from '@ts-kizuna/core/adapter';
import { createMcpServer, type McpServerOptions } from './server.js';

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
     * Predicate to filter which routes become MCP tools.
     * Return false to exclude a route.
     * By default, multipart/form-data and application/x-www-form-urlencoded routes are excluded.
     */
    routeFilter?: McpServerOptions['routeFilter'];
}

const methodNotAllowed = (message: string): Response =>
    Response.json(
        {
            jsonrpc: '2.0',
            error: {
                code: -32000,
                message,
            },
            id: null,
        },
        {
            status: 405,
        }
    );

/**
 * Create a Payload plugin that mounts an MCP endpoint.
 *
 * Each route in the contract becomes an MCP tool that AI assistants can
 * discover and call. Handlers receive `{ req }` with the full `PayloadRequest`.
 *
 * ```ts
 * import { buildConfig } from 'payload';
 * import { kizunaPlugin } from '@ts-kizuna/payload';
 * import { kizunaMcpPlugin } from '@ts-kizuna/mcp/payload';
 * import { api } from './lib/api';
 *
 * export default buildConfig({
 *     plugins: [kizunaPlugin(api), kizunaMcpPlugin(api)],
 * });
 * ```
 */
export function kizunaMcpPlugin(api: Contract & ApiWithRouter, options?: McpEndpointOptions): (incomingConfig: Config) => Config {
    const mountPath = options?.path ?? '/mcp';

    return (incomingConfig: Config): Config => {
        const endpoints: Endpoint[] = [
            {
                path: mountPath,
                method: 'post',
                handler: async (req: PayloadRequest) => {
                    const server = createMcpServer(api, {
                        ...options,
                        handlerContext: {
                            req,
                        },
                    });
                    const transport = new WebStandardStreamableHTTPServerTransport({
                        sessionIdGenerator: undefined,
                    });
                    await server.connect(transport);
                    return transport.handleRequest(req as unknown as Request);
                },
            },
            {
                path: mountPath,
                method: 'get',
                handler: async () => {
                    return methodNotAllowed('Method not allowed. Use POST for MCP requests.');
                },
            },
            {
                path: mountPath,
                method: 'delete',
                handler: async () => {
                    return methodNotAllowed('Method not allowed. Stateless server does not support session termination.');
                },
            },
        ];

        return {
            ...incomingConfig,
            endpoints: [...(incomingConfig.endpoints ?? []), ...endpoints],
        };
    };
}
