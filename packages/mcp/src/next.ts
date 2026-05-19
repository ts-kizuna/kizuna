import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Contract } from '@ts-kizuna/core';
import { type ApiDefinition } from '@ts-kizuna/core/adapter';
import { createMcpServer, type McpServerOptions } from './server.js';

type HttpHandler = (request: Request) => Promise<Response>;

interface McpEndpoints {
    GET: HttpHandler;
    POST: HttpHandler;
    DELETE: HttpHandler;
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
 * Streamable HTTP transport requires.
 *
 * ```ts
 * // app/mcp/route.ts
 * import { createMcpEndpoint } from '@ts-kizuna/mcp/next';
 * import { api } from '../../lib/api';
 *
 * export const { GET, POST, DELETE } = createMcpEndpoint(api, {
 *     baseUrl: 'http://localhost:3000',
 * });
 * ```
 */
export const createMcpEndpoint = (api: Contract & ApiDefinition, options: McpServerOptions): McpEndpoints => {
    const POST: HttpHandler = async (request: Request) => {
        const server = createMcpServer(api, options);
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
