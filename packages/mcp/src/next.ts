import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Routes } from '@ts-kizuna/core';
import { type ApiWithRouter, type KizunaPlugin, headersToObject } from '@ts-kizuna/core/adapter';
import { createMcpServer, type McpServerOptions } from './server.js';

type HttpHandler = (request: Request) => Promise<Response>;

interface McpEndpoints {
    GET: HttpHandler;
    POST: HttpHandler;
    DELETE: HttpHandler;
}

interface NextApp {
    get(path: string, handler: HttpHandler): void;
    post(path: string, handler: HttpHandler): void;
    delete(path: string, handler: HttpHandler): void;
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
     * Predicate to filter which routes become MCP tools. Return `false` to
     * exclude a route. By default, `multipart/form-data` and
     * `application/x-www-form-urlencoded` routes are excluded.
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
 * Serve an MCP endpoint from a Next.js App Router route file. Each route
 * becomes an MCP tool; calling the tool invokes the api's handler for that
 * route.
 *
 * @example
 * ```ts
 * // app/mcp/route.ts
 * export const { GET, POST, DELETE } = createMcpEndpoint(api);
 * ```
 */
export const createMcpEndpoint = (api: ApiWithRouter, options?: McpEndpointOptions): McpEndpoints => {
    const POST: HttpHandler = async (request: Request) => {
        const server = createMcpServer(api, {
            ...options,
            handlerContext: {
                request,
            },
            credentialHeaders: headersToObject(request.headers),
        });
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

/**
 * Let AI assistants use your API. This serves a Model Context Protocol endpoint
 * at `/mcp`, where every route shows up as a tool an assistant can discover and
 * call, behind the same guards as the HTTP endpoints.
 *
 * The catch-all route file that already serves your contract serves this too,
 * so the path is relative to its `basePath`: the usual
 * `app/api/[...ts-kizuna]/route.ts` with `basePath: '/api'` puts the endpoint
 * at `/api/mcp`.
 *
 * @example
 * ```ts
 * export const api = server.api({
 *     router,
 *     plugins: [mcpPlugin()],
 * });
 * ```
 */
export const mcpPlugin = (options?: McpEndpointOptions & { path?: string }): KizunaPlugin<NextApp> => ({
    name: '@ts-kizuna/mcp',
    mount: (app, api) => {
        const { GET, POST, DELETE } = createMcpEndpoint(api, options);
        const mountPath = options?.path ?? '/mcp';
        app.get(mountPath, GET);
        app.post(mountPath, POST);
        app.delete(mountPath, DELETE);
    },
});
