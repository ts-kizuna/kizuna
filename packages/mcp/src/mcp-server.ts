import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/server';
import { flattenRoutes, validateRequest } from '@ts-kizuna/core/adapter';
import {
    ResponseError,
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
    guardDenyFor,
    isGuardDenial,
} from '@ts-kizuna/core/adapter';
import { contractOf } from '@ts-kizuna/core/adapter';
import type { Contract, Routes, RouteDefinition, SecurityScheme } from '@ts-kizuna/core';
import { isIdempotentMethod, isSafeMethod } from './method.js';
import { deriveToolNames } from '@ts-kizuna/core/generator';
import { flattenTools, toolRunnerFrom, TOOLS_META, type ToolsMeta } from '@ts-kizuna/core/adapter';
import { publishedTools, type PublishedTool, type Tools, type ToolDispatchOutcome, type UntrustedToolCall } from '@ts-kizuna/core';
import { buildToolInputSchema, buildToolOutputSchema, type ToolInputSchema } from './schema.js';

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
     * Keep only the methods RFC 9110 calls safe, so no tool an assistant calls
     * can change data.
     *
     * @default false
     */
    onlyReadOnly?: boolean;

    /**
     * Guidance for the model, appended to the overview built from the
     * contract's tags. Use it for what belongs to no single route: the order
     * operations happen in, the conventions every route shares.
     */
    instructions?: string;

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

    /**
     * A scheme the transport has already verified for this request. Its guard
     * and access gates are skipped per tool call, and `context` reaches
     * handlers under `auth.<scheme>`.
     */
    transportAuth?: {
        scheme: string;
        context?: Record<string, unknown>;
    };
}

interface Annotations {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
}

/**
 * Hints from the method's HTTP semantics, per RFC 9110. MCP already defaults
 * `destructiveHint` and `openWorldHint` to true, so only the hints that make a
 * tool safer than that are worth setting.
 */
const buildToolAnnotations = (route: RouteDefinition): Annotations => ({
    ...(isSafeMethod(route.method) ? { readOnlyHint: true } : {}),
    ...(isIdempotentMethod(route.method) ? { idempotentHint: true } : {}),
    ...(route.method === 'DELETE' ? { destructiveHint: true } : {}),
});

const describeRequirement = (route: RouteDefinition, scheme: string, scopes: readonly string[]): string => {
    const constraints = scopes.length > 0 ? [`scopes: ${scopes.join(', ')}`] : [];

    for (const [field, allowed] of Object.entries(route.accessGate?.[scheme] ?? {})) {
        const values = Array.isArray(allowed) ? allowed : [allowed];
        constraints.push(`${field}: ${values.join(', ')}`);
    }

    return constraints.length > 0 ? `${scheme} (${constraints.join('; ')})` : scheme;
};

const buildToolDescription = (route: RouteDefinition): string => {
    const parts: string[] = [];
    if (route.summary) parts.push(route.summary);
    if (route.description) parts.push(route.description);
    if (parts.length === 0) parts.push(`${route.method} ${route.path}`);
    parts.push(`\nHTTP: ${route.method} ${route.path}`);

    const requirements = resolveSecurityRequirements(route);
    if (requirements.length > 0) {
        parts.push(`Requires: ${requirements.map(({ scheme, scopes }) => describeRequirement(route, scheme, scopes)).join(', ')}`);
    }

    return parts.join('\n');
};

export interface ToolDefinition {
    name: string;
    title: string | undefined;
    description: string;
    inputSchema: ToolInputSchema;
    outputSchema: z.ZodType;
    route: RouteDefinition;
    routeKey: string;
    tags: string[];
}

/**
 * The tools a server publishes: everything the contract declares, less the ones
 * that change data when `onlyReadOnly` is set.
 *
 * There is no selection map. A route reaches a model by being named in the tool
 * tree with `k.tools.fromRoute`, so not publishing one is not writing the line.
 */
export const buildDeclaredToolDefinitions = (tools: Tools | undefined, options?: McpServerOptions): PublishedTool[] => {
    if (!tools) return [];
    const selected = publishedTools(flattenTools(tools)).filter(
        (tool) => options?.onlyReadOnly !== true || tool.annotations?.readOnlyHint === true
    );
    // Names are derived once here so a bad key fails at startup, not at call time.
    deriveToolNames(
        selected.map(({ toolKey }) => ({
            key: toolKey,
            origin: 'tool',
        }))
    );
    return selected;
};

/**
 * A tool's description with what it requires appended, so a model reads the
 * constraint alongside what the tool does. A route-derived tool takes the
 * route's own requirements; a declared one takes its identity.
 */
const publishedDescription = (published: PublishedTool): string => {
    if (published.route !== undefined) {
        const route = published.route;
        const requirements = resolveSecurityRequirements(route);
        if (requirements.length === 0) return published.description;
        const described = requirements.map(({ scheme, scopes }) => describeRequirement(route, scheme, scopes)).join(', ');
        return `${published.description}\nRequires: ${described}`;
    }
    return published.identity === undefined ? published.description : `${published.description}\nRequires: ${published.identity}`;
};

/**
 * What a client puts in front of the model before it picks a tool.
 */
export const buildInstructions = (
    contract: Contract | undefined,
    published: readonly PublishedTool[],
    authored: string | undefined
): string => {
    const sections: string[] = [];
    const routeBacked = published.filter((tool) => tool.route !== undefined);
    if (routeBacked.length > 0) {
        sections.push('Every tool named after an HTTP route returns `{ status, body }`. A status of 400 or more means the call failed.');
    }
    if (routeBacked.length < published.length) {
        sections.push('The remaining tools return their own result directly.');
    }

    const tags = contract?.tags?.tags;
    if (tags !== undefined) {
        // A group whose every route was excluded is not a group the model has.
        const exposed = new Set(routeBacked.flatMap((tool) => tool.routeTags ?? []));
        const groups = Object.entries(tags)
            .filter(([key]) => exposed.has(key))
            .map(([, tag]) => (tag.description ? `- ${tag.title}: ${tag.description}` : `- ${tag.title}`));
        if (groups.length > 0) sections.push(`Groups:\n${groups.join('\n')}`);
    }

    if (authored) sections.push(authored);

    return sections.join('\n\n');
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

type ToolCallResult = { content: Array<{ type: 'text'; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };

/**
 * The `{ status, body }` envelope every tool returns. A success also rides
 * along as `structuredContent`, matching the advertised output schema.
 */
const toolEnvelope = (status: number, body: unknown): ToolCallResult => {
    const envelope = {
        status,
        body,
    };
    const isError = status >= 400;

    return {
        content: [
            {
                type: 'text' as const,
                text: JSON.stringify(envelope, null, 2),
            },
        ],
        ...(isError
            ? {}
            : {
                  structuredContent: envelope,
              }),
        isError,
    };
};

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
    requirements: ReturnType<typeof resolveSecurityRequirements>,
    accessGate: RouteDefinition['accessGate'],
    label: string,
    params: Record<string, string>,
    guards: GuardMap | undefined,
    schemes: Record<string, SecurityScheme> | undefined,
    handlerContext: Record<string, unknown> | undefined,
    credentialHeaders: Record<string, string | string[] | undefined> | undefined,
    transportAuth: McpServerOptions['transportAuth']
): Promise<{ ok: true; securityContext: Record<string, unknown> } | { ok: false; result: ToolCallResult }> => {
    const securityContext: Record<string, unknown> = {};
    const credentialRequest = {
        headers: credentialHeaders ?? {},
        query: {},
    } as unknown as AdapterRequest<unknown>;

    for (const { scheme, scopes } of requirements) {
        if (scheme === transportAuth?.scheme) {
            if (transportAuth.context !== undefined) securityContext[scheme] = transportAuth.context;
            continue;
        }
        const guard = guards?.[scheme];
        if (!guard) {
            return {
                ok: false,
                result: toolError(500, `No guard registered for security scheme "${scheme}" required by ${label}.`),
            };
        }
        const schemeDefinition = schemes?.[scheme];
        const credential = schemeDefinition ? extractCredential(schemeDefinition, credentialRequest) : {};
        const guardResult = await guard({
            ...(handlerContext ?? {}),
            ...credential,
            params,
            deny: guardDenyFor(schemeDefinition),
            scopes,
        } as Parameters<typeof guard>[0]);
        if (isGuardDenial(guardResult)) {
            return {
                ok: false,
                result: toolError(guardResult.status, guardResult.detail),
            };
        }
        for (const [field, allowed] of Object.entries(accessGate?.[scheme] ?? {})) {
            if (gatePermits((guardResult ?? {})[field as never], allowed)) continue;
            return {
                ok: false,
                result: toolError(403, `Forbidden: ${scheme}.${field} is not permitted on this route.`),
            };
        }
        if (guardResult && typeof guardResult === 'object') {
            securityContext[scheme] = guardResult;
        }
    }

    return {
        ok: true,
        securityContext,
    };
};

/**
 * Dispatching a tool, pulled out as its own type because `ToolRunner` over the
 * erased `Tools` reaches its own methods through the tool tree's index
 * signature, which `noUncheckedIndexedAccess` then widens with `undefined`.
 */
type DeclaredToolDispatch = (call: UntrustedToolCall) => Promise<ToolDispatchOutcome<Tools>>;

/**
 * The two methods a tool call needs: binding the identity this request
 * verified, then dispatching against it.
 */
interface DeclaredToolRunner {
    dispatch: DeclaredToolDispatch;
    as: (auth: Record<string, unknown>) => DeclaredToolRunner;
}

/**
 * The identities a tool requires, with the scopes and gate each one carries.
 * A route-derived tool takes the route's own, so authorization is declared once
 * in the auth map and governs both surfaces.
 */
export const toolRequirements = (
    definition: PublishedTool
): { requirements: ReturnType<typeof resolveSecurityRequirements>; accessGate: RouteDefinition['accessGate'] } => {
    if (definition.route !== undefined) {
        return {
            requirements: resolveSecurityRequirements(definition.route),
            accessGate: definition.route.accessGate,
        };
    }
    return {
        requirements:
            definition.identity === undefined
                ? []
                : [
                      {
                          scheme: definition.identity,
                          scopes: [],
                      },
                  ],
        accessGate: undefined,
    };
};

/**
 * Run one tool. Whatever it is behind, the guards its identities require run
 * first against the transport's credentials, and their verified context is
 * bound to the runner before the call.
 */
const executeToolCall = async (
    definition: PublishedTool,
    args: Record<string, unknown>,
    runner: DeclaredToolRunner | undefined,
    handlerContext?: Record<string, unknown>,
    guards?: GuardMap,
    schemes?: Record<string, SecurityScheme>,
    credentialHeaders?: Record<string, string | string[] | undefined>,
    transportAuth?: McpServerOptions['transportAuth']
): Promise<ToolCallResult> => {
    if (!runner) {
        return toolError(500, `No handler was bound for tool "${definition.toolKey}".`);
    }

    const { requirements, accessGate } = toolRequirements(definition);

    let bound = runner;
    if (requirements.length > 0) {
        const params = (args['params'] ?? {}) as Record<string, string>;
        const guardOutcome = await runGuards(
            requirements,
            accessGate,
            `tool "${definition.toolKey}"`,
            params,
            guards,
            schemes,
            handlerContext,
            credentialHeaders,
            transportAuth
        );
        if (!guardOutcome.ok) return guardOutcome.result;
        bound = runner.as(guardOutcome.securityContext);
    }

    const outcome = await bound.dispatch({
        id: definition.name,
        name: definition.toolKey,
        input: args,
    });

    if (!outcome.ok) {
        return {
            content: [
                {
                    type: 'text' as const,
                    text: outcome.message,
                },
            ],
            isError: true,
        };
    }

    const value = (outcome as { output?: unknown }).output;
    const failed =
        definition.route !== undefined && typeof (value as { status?: unknown })?.status === 'number'
            ? (value as { status: number }).status >= 400
            : false;

    return {
        content: [
            {
                type: 'text' as const,
                text: definition.output ? JSON.stringify(value, null, 2) : `${definition.toolKey} ran.`,
            },
        ],
        ...(definition.output && !failed
            ? {
                  structuredContent: value as Record<string, unknown>,
              }
            : {}),
        isError: failed,
    };
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

    const contract = contractOf<Contract | undefined>(api);
    const toolsMeta = (api as unknown as Record<typeof TOOLS_META, ToolsMeta | undefined>)[TOOLS_META];
    // Reached through the tool tree's index signature, so narrowed once here
    // rather than at every call site.
    const toolRunner = toolRunnerFrom(
        toolsMeta === undefined
            ? undefined
            : {
                  ...toolsMeta,
                  // The transport's context, spread into a route handler the way
                  // the HTTP pipeline spreads its own.
                  handlerContext: {
                      ...toolsMeta.handlerContext,
                      ...options?.handlerContext,
                  },
              }
    ) as DeclaredToolRunner | undefined;

    const published = buildDeclaredToolDefinitions(contract?.tools, options);

    const server = new McpServer(
        {
            name: options?.name ?? 'MCP Server',
            version: options?.version ?? '1.0.0',
        },
        {
            instructions: buildInstructions(contract, published, options?.instructions),
        }
    );

    for (const definition of published) {
        server.registerTool(
            definition.name,
            {
                ...(definition.title === undefined
                    ? {}
                    : {
                          title: definition.title,
                      }),
                description: publishedDescription(definition),
                inputSchema: definition.input,
                outputSchema: definition.output,
                annotations: definition.annotations ?? {},
            },
            async (args: unknown) =>
                executeToolCall(
                    definition,
                    (args ?? {}) as Record<string, unknown>,
                    toolRunner,
                    options?.handlerContext,
                    guards,
                    schemes,
                    options?.credentialHeaders,
                    options?.transportAuth
                )
        );
    }

    return server;
};
