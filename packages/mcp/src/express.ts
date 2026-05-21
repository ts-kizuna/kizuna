import type { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Contract } from '@ts-kizuna/core';
import { type ApiWithRouter, ROUTER_META } from '@ts-kizuna/core/adapter';
import { createMcpServer, type McpServerOptions } from './server.js';

interface AppLike {
    post(path: string, ...handlers: Array<(req: Request, res: Response) => void>): void;
    get(path: string, ...handlers: Array<(req: Request, res: Response) => void>): void;
    delete(path: string, ...handlers: Array<(req: Request, res: Response) => void>): void;
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
     * Predicate to filter which routes become MCP tools.
     * Return false to exclude a route.
     * By default, multipart/form-data and application/x-www-form-urlencoded routes are excluded.
     */
    routeFilter?: McpServerOptions['routeFilter'];
}

/**
 * Mount an MCP endpoint on an Express app.
 *
 * Each route in the contract becomes an MCP tool. When an AI assistant calls
 * a tool, the corresponding handler from the api's router is invoked directly.
 *
 * ```ts
 * import { createExpressEndpoints } from '@ts-kizuna/express';
 * import { createMcpEndpoint } from '@ts-kizuna/mcp/express';
 * import { api } from './lib/api';
 *
 * const app = express();
 * app.use(express.json());
 *
 * createExpressEndpoints(api, app);
 * createMcpEndpoint(api, app);
 *
 * app.listen(3000);
 * ```
 */
export const createMcpEndpoint = (api: Contract & ApiWithRouter, app: AppLike, options?: McpEndpointOptions): void => {
    const mountPath = options?.path ?? '/mcp';
    const router = api[ROUTER_META];

    app.post(mountPath, async (request: Request, response: Response) => {
        const server = createMcpServer(api, router, options);
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
        });
        await server.connect(transport);
        await transport.handleRequest(request, response, request.body);
    });

    app.get(mountPath, (_request: Request, response: Response) => {
        response.status(405).json({
            jsonrpc: '2.0',
            error: {
                code: -32000,
                message: 'Method not allowed. Use POST for MCP requests.',
            },
            id: null,
        });
    });

    app.delete(mountPath, (_request: Request, response: Response) => {
        response.status(405).json({
            jsonrpc: '2.0',
            error: {
                code: -32000,
                message: 'Method not allowed. Stateless server does not support session termination.',
            },
            id: null,
        });
    });
};
