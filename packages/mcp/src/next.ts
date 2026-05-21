import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Contract } from '@ts-kizuna/core';
import { type ApiWithRouter, ROUTER_META } from '@ts-kizuna/core/adapter';
import { createMcpServer, type McpServerOptions } from './server.js';

type HttpHandler = (request: Request) => Promise<Response>;

interface McpEndpoints {
    GET: HttpHandler;
    POST: HttpHandler;
    DELETE: HttpHandler;
}

export interface McpEndpointOptions {
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
    new Response(
        JSON.stringify({
            jsonrpc: '2.0',
            error: {
                code: -32000,
                message,
            },
            id: null,
        }),
        {
            status: 405,
            headers: {
                'Content-Type': 'application/json',
            },
        }
    );

/**
 * Create MCP route handlers for a Next.js App Router route file.
 *
 * Returns `{ GET, POST, DELETE }` — the three HTTP methods the MCP
 * Streamable HTTP transport requires. Each route in the contract becomes
 * an MCP tool that invokes the corresponding handler directly.
 *
 * ```ts
 * // app/mcp/route.ts
 * import { createMcpEndpoint } from '@ts-kizuna/mcp/next';
 * import { api } from '../../lib/api';
 *
 * export const { GET, POST, DELETE } = createMcpEndpoint(api);
 * ```
 */
export const createMcpEndpoint = (api: Contract & ApiWithRouter, options?: McpEndpointOptions): McpEndpoints => {
    const router = api[ROUTER_META];

    const POST: HttpHandler = async (request: Request) => {
        const server = createMcpServer(api, router, options);
        const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
        });
        await server.connect(transport);
        return transport.handleRequest(request);
    };

    const GET: HttpHandler = async () => {
        return methodNotAllowed('Method not allowed. Use POST for MCP requests.');
    };

    const DELETE: HttpHandler = async () => {
        return methodNotAllowed('Method not allowed. Stateless server does not support session termination.');
    };

    return {
        GET,
        POST,
        DELETE,
    };
};
