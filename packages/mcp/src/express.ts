import type { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Contract } from '@ts-kizuna/core';
import { type ApiDefinition } from '@ts-kizuna/core/adapter';
import { createMcpServer, type McpServerOptions } from './server.js';

interface AppLike {
    post(path: string, ...handlers: Array<(req: Request, res: Response) => void>): void;
    get(path: string, ...handlers: Array<(req: Request, res: Response) => void>): void;
    delete(path: string, ...handlers: Array<(req: Request, res: Response) => void>): void;
}

export interface McpEndpointOptions extends McpServerOptions {
    /**
     * Path where the MCP endpoint is mounted.
     *
     * @default '/mcp'
     */
    path?: string;
}

/**
 * Mount an MCP endpoint on an Express app.
 *
 * Each route in the contract becomes an MCP tool. AI assistants connect
 * to the endpoint and call tools that proxy HTTP requests to `baseUrl`.
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
 * createMcpEndpoint(api, app, {
 *     baseUrl: 'http://localhost:3000',
 * });
 *
 * app.listen(3000);
 * ```
 */
export const createMcpEndpoint = (api: Contract & ApiDefinition, app: AppLike, options: McpEndpointOptions): void => {
    const mountPath = options.path ?? '/mcp';

    app.post(mountPath, async (request: Request, response: Response) => {
        const server = createMcpServer(api, options);
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
