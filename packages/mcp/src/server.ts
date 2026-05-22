import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { flattenContract, validateRequest } from '@ts-kizuna/core';
import { ResponseError, type ApiWithRouter, ROUTER_META } from '@ts-kizuna/core/adapter';
import type { Contract, RouteDefinition } from '@ts-kizuna/core';
import { deriveToolNames } from './tool-name.js';
import { buildToolInputSchema, type ToolInputSchema } from './schema.js';

export interface McpServerOptions {
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
    routeFilter?: (route: RouteDefinition, routeKey: string) => boolean;

    /**
     * Extra context spread into every handler call.
     *
     * Adapter-specific endpoints populate this automatically with the
     * framework's request object (e.g. `{ req, res }` for Express,
     * `{ request }` for Next.js).
     */
    handlerContext?: Record<string, unknown>;
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

export const buildToolDefinitions = (contract: Contract, options?: McpServerOptions): ToolDefinition[] => {
    const filter = options?.routeFilter ?? defaultRouteFilter;
    const routes = flattenContract(contract).filter(({ route, routeKey }: { route: RouteDefinition; routeKey: string }) =>
        filter(route, routeKey)
    );
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

const resolveHandler = (router: Record<string, unknown>, routeKey: string): unknown => {
    const segments = routeKey.split('.');
    let current: unknown = router;
    for (const segment of segments) {
        if (!current || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[segment];
    }
    return current;
};

type ToolCallResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

const executeToolCall = async (
    route: RouteDefinition,
    routeKey: string,
    args: Record<string, unknown>,
    router: Record<string, unknown>,
    handlerContext?: Record<string, unknown>
): Promise<ToolCallResult> => {
    const params = (args.params ?? {}) as Record<string, string>;
    const query = (args.query ?? {}) as Record<string, unknown>;
    const body = args.body;

    const validation = validateRequest(route, {
        params,
        query,
        body,
        headers: {},
    });

    if (!validation.ok) {
        return {
            content: [
                {
                    type: 'text' as const,
                    text: JSON.stringify(
                        {
                            status: 400,
                            body: {
                                message: `Validation failed: ${validation.error.stage}`,
                                issues: validation.error.issues,
                            },
                        },
                        null,
                        2
                    ),
                },
            ],
            isError: true,
        };
    }

    const handler = resolveHandler(router, routeKey);
    if (typeof handler !== 'function') {
        return {
            content: [
                {
                    type: 'text' as const,
                    text: JSON.stringify(
                        {
                            status: 500,
                            body: {
                                message: `Handler not implemented: ${routeKey}`,
                            },
                        },
                        null,
                        2
                    ),
                },
            ],
            isError: true,
        };
    }

    try {
        const error = (response: { status: number; body: unknown; headers?: Record<string, string> }): never => {
            throw new ResponseError(response);
        };

        const result = await (handler as (args: unknown) => Promise<{ status: number; body: unknown }>)({
            params: validation.parsed.params,
            query: validation.parsed.query,
            body: validation.parsed.body,
            headers: validation.parsed.headers,
            error,
            ...handlerContext,
        });

        const isError = result.status >= 400;

        return {
            content: [
                {
                    type: 'text' as const,
                    text: JSON.stringify(
                        {
                            status: result.status,
                            body: result.body,
                        },
                        null,
                        2
                    ),
                },
            ],
            isError,
        };
    } catch (error) {
        if (error instanceof ResponseError) {
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify(
                            {
                                status: error.status,
                                body: error.body,
                            },
                            null,
                            2
                        ),
                    },
                ],
                isError: error.status >= 400,
            };
        }

        return {
            content: [
                {
                    type: 'text' as const,
                    text: JSON.stringify(
                        {
                            status: 500,
                            body: {
                                message: error instanceof Error ? error.message : 'Internal Server Error',
                            },
                        },
                        null,
                        2
                    ),
                },
            ],
            isError: true,
        };
    }
};

/**
 * Create an MCP server from a kizuna API.
 *
 * Each route in the contract becomes an MCP tool. When an AI assistant calls
 * a tool, the corresponding handler is invoked directly.
 *
 * ```ts
 * import { createMcpServer } from '@ts-kizuna/mcp';
 * import { api } from './api';
 *
 * const server = createMcpServer(api);
 * ```
 */
export const createMcpServer = (api: Contract & ApiWithRouter, options?: McpServerOptions): McpServer => {
    const router = api[ROUTER_META];

    const server = new McpServer({
        name: options?.name ?? 'MCP Server',
        version: options?.version ?? '1.0.0',
    });

    const definitions = buildToolDefinitions(api, options);

    for (const definition of definitions) {
        server.registerTool(
            definition.name,
            {
                description: definition.description,
                inputSchema: definition.inputSchema.shape,
                annotations: buildToolAnnotations(definition.route),
            },
            async (args: Record<string, unknown>) =>
                executeToolCall(definition.route, definition.routeKey, args ?? {}, router, options?.handlerContext)
        );
    }

    return server;
};
