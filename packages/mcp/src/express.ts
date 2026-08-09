import type { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Routes } from '@ts-kizuna/core';
import { type ApiWithRouter } from '@ts-kizuna/core/adapter';
import type { KizunaPlugin } from '@ts-kizuna/core/adapter';
import { createMcpServer, type McpServerOptions } from './server.js';

interface ExpressApp {
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
     * Predicate to filter which routes become MCP tools. Return `false` to
     * exclude a route. By default, `multipart/form-data` and
     * `application/x-www-form-urlencoded` routes are excluded.
     */
    routeFilter?: McpServerOptions['routeFilter'];
}

/**
 * Mount an MCP endpoint on an Express app. Each route becomes an MCP tool;
 * calling the tool invokes the api's handler for that route.
 *
 * @example
 * ```ts
 * const app = express();
 * createMcpEndpoint(api, app);
 * ```
 */
export const createMcpEndpoint = (api: ApiWithRouter, app: ExpressApp, options?: McpEndpointOptions): void => {
    const mountPath = options?.path ?? '/mcp';

    app.post(mountPath, async (request: Request, response: Response) => {
        const server = createMcpServer(api, {
            ...options,
            handlerContext: {
                req: request,
                res: response,
            },
            credentialHeaders: request.headers,
        });
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

/**
 * Let AI assistants use your API. This serves a Model Context Protocol endpoint
 * at `/mcp`, where every route shows up as a tool an assistant can discover and
 * call, behind the same guards as the HTTP endpoints.
 *
 * @example
 * ```ts
 * export const api = server.api({
 *     router,
 *     plugins: [mcpPlugin()],
 * });
 * ```
 */
export const mcpPlugin = (options?: Omit<McpEndpointOptions, 'api'>): KizunaPlugin<ExpressApp> => ({
    name: '@ts-kizuna/mcp',
    mount: (app, api) => {
        createMcpEndpoint(api, app, options);
    },
});
