import { McpServer } from '@modelcontextprotocol/server';
import { flattenRoutes, validateRequest } from '@ts-kizuna/core/adapter';
import {
    ResponseError,
    isResponseError,
    type AdapterRequest,
    type ApiWithRouter,
    type GuardMap,
    type RequestContextMap,
    ROUTER_META,
    GUARDS_META,
    SCHEMES_META,
    REQUEST_CONTEXT_META,
    extractCredential,
    gatePermits,
    resolveSecurityRequirements,
    guardDeny,
    isGuardDenial,
} from '@ts-kizuna/core/adapter';
import type { Routes, RouteDefinition, SecurityScheme } from '@ts-kizuna/core';
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

    /**
     * Headers of the MCP transport request, used to extract credentials for
     * secured routes so their guards can run per tool call. Adapter-specific
     * endpoints populate this automatically; configure the MCP client to send
     * the credential (e.g. an `Authorization` header) on its connection.
     */
    credentialHeaders?: Record<string, string | string[] | undefined>;
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

export const buildToolDefinitions = (routes: Routes, options?: McpServerOptions): ToolDefinition[] => {
    const filter = options?.routeFilter ?? defaultRouteFilter;
    const flatRoutes = flattenRoutes(routes).filter(({ route, routeKey }: { route: RouteDefinition; routeKey: string }) =>
        filter(route, routeKey)
    );
    const names = deriveToolNames(flatRoutes);
    const definitions: ToolDefinition[] = [];

    for (const { routeKey, route } of flatRoutes) {
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

const toolError = (status: number, detail: string): ToolCallResult => ({
    content: [
        {
            type: 'text' as const,
            text: JSON.stringify(
                {
                    status,
                    body: {
                        detail,
                    },
                },
                null,
                2
            ),
        },
    ],
    isError: true,
});

/**
 * Run the guards a secured route requires, extracting each identity's
 * credential from the MCP transport request headers, the same pipeline the
 * HTTP adapters run. Returns the scheme-keyed security context for the handler
 * args, or a {@link ToolCallResult} error when a guard denies or a gate fails.
 */
const runGuards = async (
    route: RouteDefinition,
    routeKey: string,
    params: Record<string, string>,
    guards: GuardMap | undefined,
    schemes: Record<string, SecurityScheme> | undefined,
    handlerContext: Record<string, unknown> | undefined,
    credentialHeaders: Record<string, string | string[] | undefined> | undefined
): Promise<{ ok: true; securityContext: Record<string, unknown> } | { ok: false; result: ToolCallResult }> => {
    const securityContext: Record<string, unknown> = {};
    const credentialRequest = {
        headers: credentialHeaders ?? {},
        query: {},
    } as unknown as AdapterRequest<unknown>;

    for (const { scheme, scopes } of resolveSecurityRequirements(route)) {
        const guard = guards?.[scheme];
        if (!guard) {
            return {
                ok: false,
                result: toolError(500, `No guard registered for security scheme "${scheme}" required by route "${routeKey}".`),
            };
        }
        const schemeDefinition = schemes?.[scheme];
        const credential = schemeDefinition ? extractCredential(schemeDefinition, credentialRequest) : {};
        const guardResult = await guard({
            ...(handlerContext ?? {}),
            ...credential,
            params,
            deny: guardDeny,
            scopes,
        } as Parameters<typeof guard>[0]);
        if (isGuardDenial(guardResult)) {
            return {
                ok: false,
                result: toolError(guardResult.status, guardResult.detail),
            };
        }
        if (guardResult && typeof guardResult === 'object') {
            const gate = route.accessGate?.[scheme];
            if (gate) {
                for (const [field, allowed] of Object.entries(gate)) {
                    const value = (guardResult as Record<string, unknown>)[field];
                    const permitted = gatePermits(value, allowed);
                    if (!permitted) {
                        return {
                            ok: false,
                            result: toolError(403, `Forbidden: ${scheme}.${field} is not permitted on this route.`),
                        };
                    }
                }
            }
            securityContext[scheme] = guardResult;
        }
    }

    return {
        ok: true,
        securityContext,
    };
};

const executeToolCall = async (
    route: RouteDefinition,
    routeKey: string,
    args: Record<string, unknown>,
    router: Record<string, unknown>,
    handlerContext?: Record<string, unknown>,
    guards?: GuardMap,
    schemes?: Record<string, SecurityScheme>,
    credentialHeaders?: Record<string, string | string[] | undefined>,
    contextResolvers?: RequestContextMap
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
                                detail: `Validation failed: ${validation.error.stage}`,
                                errors: validation.error.issues,
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
                                detail: `Handler not implemented: ${routeKey}`,
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

    const requestContext: Record<string, unknown> = {};
    if (contextResolvers) {
        for (const [name, resolver] of Object.entries(contextResolvers)) {
            requestContext[name] = await resolver({
                ...(handlerContext ?? {}),
                params,
                headers: credentialHeaders ?? {},
            } as Parameters<typeof resolver>[0]);
        }
    }

    const guardOutcome = await runGuards(route, routeKey, params, guards, schemes, handlerContext, credentialHeaders);
    if (!guardOutcome.ok) {
        return guardOutcome.result;
    }

    try {
        const throwError = (response: { status: number; body: unknown; headers?: Record<string, string> }): never => {
            throw new ResponseError(response);
        };

        const result = await (handler as (args: unknown) => Promise<{ status: number; body: unknown }>)({
            params: validation.parsed.params,
            query: validation.parsed.query,
            body: validation.parsed.body,
            headers: validation.parsed.headers,
            throwError,
            ...handlerContext,
            ...(Object.keys(requestContext).length > 0 ? { requestContext } : {}),
            ...(Object.keys(guardOutcome.securityContext).length > 0 ? { auth: guardOutcome.securityContext } : {}),
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
        if (isResponseError(error)) {
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
                                detail: error instanceof Error ? error.message : 'Internal Server Error',
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
 * Each route in the routes becomes an MCP tool. When an AI assistant calls
 * a tool, the corresponding handler is invoked directly.
 *
 * ```ts
 * import { createMcpServer } from '@ts-kizuna/mcp';
 * import { api } from './api';
 *
 * const server = createMcpServer(api);
 * ```
 */
export const createMcpServer = (api: ApiWithRouter, options?: McpServerOptions): McpServer => {
    const router = api[ROUTER_META];
    const guards = (api as unknown as Record<typeof GUARDS_META, GuardMap | undefined>)[GUARDS_META];
    const schemes = (api as unknown as Record<typeof SCHEMES_META, Record<string, SecurityScheme> | undefined>)[SCHEMES_META];
    const contextResolvers = (api as unknown as Record<typeof REQUEST_CONTEXT_META, RequestContextMap | undefined>)[REQUEST_CONTEXT_META];

    const server = new McpServer({
        name: options?.name ?? 'MCP Server',
        version: options?.version ?? '1.0.0',
    });

    const definitions = buildToolDefinitions(api.routes, options);

    for (const definition of definitions) {
        server.registerTool(
            definition.name,
            {
                description: definition.description,
                inputSchema: definition.inputSchema.shape,
                annotations: buildToolAnnotations(definition.route),
            },
            async (args: Record<string, unknown>) =>
                executeToolCall(
                    definition.route,
                    definition.routeKey,
                    args ?? {},
                    router,
                    options?.handlerContext,
                    guards,
                    schemes,
                    options?.credentialHeaders,
                    contextResolvers
                )
        );
    }

    return server;
};
