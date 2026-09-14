import { z } from 'zod';
import { problemDetails } from '@ts-kizuna/core';
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
    GUARD_SCHEMA_META,
    REQUEST_CONTEXT_META,
    extractCredential,
    requiresDenial,
    withPermissions,
    type GuardDenialBody,
    resolveSecurityRequirements,
    guardDenyFor,
    isGuardDenial,
} from '@ts-kizuna/core/adapter';
import { contractOf } from '@ts-kizuna/core/adapter';
import type { Contract, RequiredPermissions, RouteDefinition, SecurityScheme } from '@ts-kizuna/core';
import { deriveToolNames } from '@ts-kizuna/core/generator';
import { bindToolRunner, flattenTools, toolRunnerFrom, TOOLS_META, type ToolsMeta } from '@ts-kizuna/core/adapter';
import { resolveTools, type ResolvedTool, type Tools, type ToolDispatchOutcome, type UntrustedToolCall } from '@ts-kizuna/core';

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
     * contract's tags. For what belongs to no single route: the order
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
     * is skipped per tool call, and `context` reaches handlers under
     * `auth.<scheme>`.
     */
    transportAuth?: {
        scheme: string;
        context?: Record<string, unknown>;
    };
}

const describeRoles = (roles: readonly string[] | undefined): string | undefined =>
    roles !== undefined && roles.length > 0 ? `Roles: ${roles.join(', ')}` : undefined;

const describeRequires = (requires: RequiredPermissions | undefined): string | undefined => {
    if (requires === undefined) return undefined;
    const names = Object.entries(requires).flatMap(([resource, verbs]) => verbs.map((verb) => `${resource}:${verb}`));
    return names.length > 0 ? `Permissions: ${names.join(', ')}` : undefined;
};

/**
 * What the server offers a model: every tool on the contract, less the ones
 * that change data when `onlyReadOnly` is set.
 */
export const toolsOffered = (tools: Tools | undefined, options?: McpServerOptions): ResolvedTool[] => {
    if (!tools) return [];
    const selected = resolveTools(flattenTools(tools)).filter(
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
 * What a model reads before it picks the tool: its own description, then the
 * identity, roles and permissions it requires.
 */
const describeTool = (published: ResolvedTool): string => {
    const { requirements, roles, requires } = toolRequirements(published);
    const parts = [published.description];
    if (requirements.length > 0) parts.push(`Requires: ${requirements.map(({ scheme }) => scheme).join(', ')}`);
    const accepted = describeRoles(roles);
    if (accepted !== undefined) parts.push(accepted);
    const permissions = describeRequires(requires);
    if (permissions !== undefined) parts.push(permissions);
    return parts.join('\n');
};

/**
 * What a client puts in front of the model before it picks a tool.
 */
export const buildInstructions = (
    contract: Contract | undefined,
    published: readonly ResolvedTool[],
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
 * The envelope every tool returns. A success also rides along as
 * `structuredContent`, matching the advertised output schema.
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

// A tool result is `{ status, body }`, not an HTTP response, so no envelope.
const toolError = (status: number, body: GuardDenialBody): ToolCallResult => ({
    content: [
        {
            type: 'text' as const,
            text: JSON.stringify(
                {
                    status,
                    body,
                },
                null,
                2
            ),
        },
    ],
    isError: true,
});

const gateBody = (guardSchema: z.ZodType | undefined, detail: string): GuardDenialBody => {
    const filled = guardSchema?.safeParse(problemDetails(403, detail));
    return filled?.success ? (filled.data as GuardDenialBody) : { detail };
};

/**
 * Run the guards a secured tool requires, taking each identity's credential
 * from the MCP transport request headers. Answers the scheme-keyed security
 * context, or a {@link ToolCallResult} error when a guard denies, or when the
 * caller's role is not one the tool accepts or does not hold what it requires.
 */
const runGuards = async (
    requirements: ReturnType<typeof resolveSecurityRequirements>,
    roles: readonly string[] | undefined,
    requires: RequiredPermissions | undefined,
    label: string,
    params: Record<string, string>,
    guards: GuardMap | undefined,
    schemes: Record<string, SecurityScheme> | undefined,
    handlerContext: Record<string, unknown> | undefined,
    credentialHeaders: Record<string, string | string[] | undefined> | undefined,
    requestContext: Record<string, unknown>,
    transportAuth: McpServerOptions['transportAuth'],
    guardSchema: z.ZodType | undefined
): Promise<{ ok: true; securityContext: Record<string, unknown> } | { ok: false; result: ToolCallResult }> => {
    const securityContext: Record<string, unknown> = {};
    const credentialRequest = {
        headers: credentialHeaders ?? {},
        query: {},
    } as unknown as AdapterRequest<unknown>;

    for (const { scheme } of requirements) {
        if (scheme === transportAuth?.scheme) {
            if (transportAuth.context !== undefined) {
                securityContext[scheme] = withPermissions(scheme, schemes?.[scheme], transportAuth.context);
            }
            continue;
        }
        const guard = guards?.[scheme];
        if (!guard) {
            return {
                ok: false,
                result: toolError(500, {
                    detail: `No guard registered for security scheme "${scheme}" required by ${label}.`,
                }),
            };
        }
        const schemeDefinition = schemes?.[scheme];
        const credential = schemeDefinition ? extractCredential(schemeDefinition, credentialRequest) : {};
        const guardResult = await guard({
            ...(handlerContext ?? {}),
            ...credential,
            params,
            deny: guardDenyFor(schemeDefinition),
            ...(Object.keys(requestContext).length > 0 ? { requestContext } : {}),
        } as Parameters<typeof guard>[0]);
        if (isGuardDenial(guardResult)) {
            return {
                ok: false,
                result: toolError(guardResult.status, guardResult.body),
            };
        }
        if (guardResult && typeof guardResult === 'object') {
            securityContext[scheme] = withPermissions(scheme, schemeDefinition, guardResult);
        }
    }
    const forbidden = requiresDenial({
        roles,
        requires,
        requiredSchemes: requirements.map((requirement) => requirement.scheme),
        schemes,
        securityContext,
    });
    if (forbidden !== undefined) {
        return {
            ok: false,
            result: toolError(403, gateBody(guardSchema, forbidden)),
        };
    }

    return {
        ok: true,
        securityContext,
    };
};

/**
 * Dispatching a tool.
 */
type DeclaredToolDispatch = (call: UntrustedToolCall) => Promise<ToolDispatchOutcome<Tools>>;

/**
 * The two methods a tool call needs: binding the identity this request
 * verified, then dispatching against it.
 */
interface DeclaredToolRunner {
    dispatch: DeclaredToolDispatch;
}

/**
 * The identities a tool requires, with the roles it accepts and the permissions
 * it requires. A tool running a route takes the route's own.
 */
export const toolRequirements = (
    definition: ResolvedTool
): {
    requirements: ReturnType<typeof resolveSecurityRequirements>;
    roles: readonly string[] | undefined;
    requires: RequiredPermissions | undefined;
} => {
    const source =
        definition.route ?? ({ security: definition.security, roles: definition.roles, requires: definition.requires } as RouteDefinition);
    return {
        requirements: resolveSecurityRequirements(source),
        roles: source.roles,
        requires: source.requires,
    };
};

/**
 * Run one tool. The guards its identities require run first against the
 * transport's credentials, and their verified context is bound to the runner.
 */
const executeToolCall = async (
    definition: ResolvedTool,
    args: Record<string, unknown>,
    runner: DeclaredToolRunner | undefined,
    handlerContext?: Record<string, unknown>,
    guards?: GuardMap,
    schemes?: Record<string, SecurityScheme>,
    credentialHeaders?: Record<string, string | string[] | undefined>,
    transportAuth?: McpServerOptions['transportAuth'],
    contextResolvers?: RequestContextMap,
    guardSchema?: z.ZodType
): Promise<ToolCallResult> => {
    if (!runner) {
        return toolError(500, {
            detail: `No handler was bound for tool "${definition.toolKey}".`,
        });
    }

    const { requirements, roles, requires } = toolRequirements(definition);
    const params = (args['params'] ?? {}) as Record<string, string>;

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

    const securityContext: Record<string, unknown> = {};
    if (requirements.length > 0) {
        const guardOutcome = await runGuards(
            requirements,
            roles,
            requires,
            `tool "${definition.toolKey}"`,
            params,
            guards,
            schemes,
            handlerContext,
            credentialHeaders,
            requestContext,
            transportAuth,
            guardSchema
        );
        if (!guardOutcome.ok) return guardOutcome.result;
        Object.assign(securityContext, guardOutcome.securityContext);
    }

    const bound =
        Object.keys(securityContext).length > 0 || Object.keys(requestContext).length > 0
            ? (bindToolRunner(runner as never, {
                  auth: securityContext,
                  requestContext,
              }) as unknown as DeclaredToolRunner)
            : runner;

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
    const guardSchema = (api as unknown as Record<typeof GUARD_SCHEMA_META, z.ZodType | undefined>)[GUARD_SCHEMA_META];
    const contextResolvers = (api as unknown as Record<typeof REQUEST_CONTEXT_META, RequestContextMap | undefined>)[REQUEST_CONTEXT_META];

    const contract = contractOf<Contract | undefined>(api);
    const toolsMeta = (api as unknown as Record<typeof TOOLS_META, ToolsMeta | undefined>)[TOOLS_META];
    const toolRunner = toolRunnerFrom(
        toolsMeta === undefined
            ? undefined
            : {
                  ...toolsMeta,
                  handlerContext: {
                      ...toolsMeta.handlerContext,
                      ...options?.handlerContext,
                  },
              }
    ) as DeclaredToolRunner | undefined;

    const published = toolsOffered(contract?.tools, options);

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
                description: describeTool(definition),
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
                    options?.transportAuth,
                    contextResolvers,
                    guardSchema
                )
        );
    }

    return server;
};
