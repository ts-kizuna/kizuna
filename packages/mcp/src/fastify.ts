import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Routes } from '@ts-kizuna/core';
import { type ApiWithRouter } from '@ts-kizuna/core/adapter';
import { createMcpServer, type McpServerOptions } from './server.js';

export interface McpEndpointOptions {
    /**
     * The api from `Kizuna.init`.
     */
    api: Routes & ApiWithRouter;

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
 * Fastify plugin that serves an MCP endpoint. Each route becomes an MCP tool;
 * calling the tool invokes the api's handler for that route.
 *
 * @example
 * ```ts
 * app.register(mcpPlugin, {
 *     api,
 * });
 * ```
 */
export const fastifyKizunaMcp = async (app: FastifyInstance, options: McpEndpointOptions): Promise<void> => {
    const { api } = options;
    const mountPath = options.path ?? '/mcp';

    app.post(mountPath, async (request: FastifyRequest, reply: FastifyReply) => {
        const server = createMcpServer(api, {
            ...options,
            handlerContext: {
                request,
                reply,
            },
            credentialHeaders: request.headers,
        });
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
        });
        await server.connect(transport);
        reply.hijack();
        await transport.handleRequest(request.raw, reply.raw, request.body);
    });

    app.get(mountPath, (_request: FastifyRequest, reply: FastifyReply) => {
        reply.status(405).send({
            jsonrpc: '2.0',
            error: {
                code: -32000,
                message: 'Method not allowed. Use POST for MCP requests.',
            },
            id: null,
        });
    });

    app.delete(mountPath, (_request: FastifyRequest, reply: FastifyReply) => {
        reply.status(405).send({
            jsonrpc: '2.0',
            error: {
                code: -32000,
                message: 'Method not allowed. Stateless server does not support session termination.',
            },
            id: null,
        });
    });
};
