import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { flattenContract, buildPath } from '@ts-kizuna/core';
import type { Contract, RouteDefinition } from '@ts-kizuna/core';
import { deriveToolNames } from './tool-name.js';
import { buildToolInputSchema, type ToolInputSchema } from './schema.js';

export interface McpServerOptions {
    /**
     * Base URL of the API the tools will call.
     * Must be a full URL (e.g. "https://api.example.com").
     */
    baseUrl: string;

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
     * Headers sent with every request.
     * Use for API keys, bearer tokens, etc.
     */
    baseHeaders?: Record<string, string>;

    /**
     * Custom fetch implementation.
     * Defaults to the global fetch.
     */
    fetch?: typeof fetch;

    /**
     * Predicate to filter which routes become MCP tools.
     * Return false to exclude a route.
     * By default, multipart/form-data and application/x-www-form-urlencoded routes are excluded.
     */
    routeFilter?: (route: RouteDefinition, routeKey: string) => boolean;
}

const defaultRouteFilter = (route: RouteDefinition): boolean => {
    return route.contentType === undefined || route.contentType === 'application/json';
};

interface Annotations {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
}

const buildToolAnnotations = (route: RouteDefinition): Annotations => {
    switch (route.method) {
        case 'GET':
        case 'HEAD':
        case 'OPTIONS':
            return {
                readOnlyHint: true,
            };
        case 'DELETE':
            return {
                destructiveHint: true,
            };
        case 'PUT':
            return {
                idempotentHint: true,
            };
        default:
            return {};
    }
};

const buildToolDescription = (route: RouteDefinition): string => {
    const parts: string[] = [];
    if (route.summary) parts.push(route.summary);
    if (route.description) parts.push(route.description);
    if (parts.length === 0) parts.push(`${route.method} ${route.path}`);
    parts.push(`\nHTTP: ${route.method} ${route.path}`);
    return parts.join('\n');
};

export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: ToolInputSchema;
    route: RouteDefinition;
    routeKey: string;
}

export const buildToolDefinitions = (contract: Contract, options: McpServerOptions): ToolDefinition[] => {
    const filter = options.routeFilter ?? defaultRouteFilter;
    const routes = flattenContract(contract).filter(({ route, routeKey }) => filter(route, routeKey));
    const names = deriveToolNames(routes);
    const definitions: ToolDefinition[] = [];

    for (const { routeKey, route } of routes) {
        const name = names.get(routeKey)!;
        definitions.push({
            name,
            description: buildToolDescription(route),
            inputSchema: buildToolInputSchema(route),
            route,
            routeKey,
        });
    }

    return definitions;
};

const executeToolCall = async (
    route: RouteDefinition,
    args: Record<string, unknown>,
    options: McpServerOptions
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> => {
    const params = (args.params ?? {}) as Record<string, string>;
    const query = (args.query ?? {}) as Record<string, unknown>;
    const body = args.body;

    const url = new URL(options.baseUrl + buildPath(route.path, params));
    for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
            for (const item of value) {
                url.searchParams.append(key, String(item));
            }
        } else {
            url.searchParams.append(key, String(value));
        }
    }

    const headers: Record<string, string> = { ...(options.baseHeaders ?? {}) };
    let fetchBody: string | undefined;
    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        fetchBody = JSON.stringify(body);
    }

    const fetchFunction = options.fetch ?? fetch;
    const response = await fetchFunction(url.toString(), {
        method: route.method,
        headers,
        body: fetchBody,
    });

    const text = await response.text();
    let parsed: unknown;
    try {
        parsed = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
        parsed = text;
    }

    const isError = response.status >= 400;

    return {
        content: [
            {
                type: 'text' as const,
                text: JSON.stringify(
                    {
                        status: response.status,
                        body: parsed,
                    },
                    null,
                    2
                ),
            },
        ],
        isError,
    };
};

/**
 * Create an MCP server from a kizuna contract.
 *
 * Each route in the contract becomes an MCP tool that proxies HTTP requests
 * to the API at `baseUrl`. Connect the returned server to any MCP transport
 * (stdio, SSE, etc.).
 *
 * ```ts
 * import { createMcpServer } from '@ts-kizuna/mcp';
 * import { contract } from './contract';
 *
 * const server = createMcpServer(contract, {
 *     baseUrl: 'https://api.example.com',
 * });
 * ```
 */
export const createMcpServer = (contract: Contract, options: McpServerOptions): McpServer => {
    const server = new McpServer({
        name: options.name ?? 'MCP Server',
        version: options.version ?? '1.0.0',
    });

    const definitions = buildToolDefinitions(contract, options);

    for (const definition of definitions) {
        server.registerTool(
            definition.name,
            {
                description: definition.description,
                inputSchema: definition.inputSchema.shape,
                annotations: buildToolAnnotations(definition.route),
            },
            async (args: Record<string, unknown>) => executeToolCall(definition.route, args ?? {}, options)
        );
    }

    return server;
};
