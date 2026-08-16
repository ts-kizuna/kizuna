import { createMcpHandler } from '@modelcontextprotocol/server';
import { adapterContextOf, implementPlugin, rawResponse, type ApiWithRouter } from '@ts-kizuna/server';
import { createMcpServer } from './mcp-server.js';
import { mcpPlugin } from './plugin.js';

export { createMcpServer, buildToolDefinitions, type McpServerOptions, type ToolDefinition } from './mcp-server.js';

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
 * Serve the `mcpPlugin` declared on the contract.
 *
 * @example
 * ```ts
 * export const api = server.api({
 *     router,
 *     plugins: {
 *         mcp: mcpPluginServer(),
 *     },
 * });
 * ```
 */
export const mcpPluginServer = () =>
    implementPlugin(mcpPlugin, ({ props, api }) => ({
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
                return rawResponse(
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
    }));
