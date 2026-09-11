import { createMcpHandler } from '@modelcontextprotocol/server';
import {
    buildProtectedResourceMetadata,
    declaredScopes,
    type Contract,
    type ProtectedResourceMetadata,
    type PublishedTool,
    type RouteDefinition,
    type SecurityScheme,
} from '@ts-kizuna/core';
import {
    adapterContextOf,
    contractOf,
    implementPlugin,
    rawResponse,
    resolveSecurityRequirements,
    GUARDS_META,
    SCHEMES_META,
    type ApiWithRouter,
    type GuardMap,
    type GuardRun,
} from '@ts-kizuna/core/adapter';
import { buildDeclaredToolDefinitions, createMcpServer, toolRequirements } from './mcp-server.js';
import { mcpPlugin } from './plugin.js';
import { assertCanonicalResource, protectedResourceMetadataUrl, type McpOAuthProps } from './oauth.js';
import { denialResponse, enforceOAuth } from './oauth-enforcement.js';

export {
    createMcpServer,
    buildDeclaredToolDefinitions,
    buildInstructions,
    type McpServerOptions,
    type ToolDefinition,
} from './mcp-server.js';

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

interface OAuthEnforcement {
    oauth: McpOAuthProps;
    guard: GuardRun;
    schemeDefinition: SecurityScheme;
    metadata: ProtectedResourceMetadata;
    metadataUrl: string;
    scopesSupported: readonly string[] | undefined;
    tools: Map<string, PublishedTool>;
}

const prepareOAuth = (oauth: McpOAuthProps, endpointPath: `/${string}`, api: ApiWithRouter, onlyReadOnly?: boolean): OAuthEnforcement => {
    assertCanonicalResource(oauth, endpointPath);
    const guards = (api as unknown as Record<typeof GUARDS_META, GuardMap | undefined>)[GUARDS_META];
    const schemes = (api as unknown as Record<typeof SCHEMES_META, Record<string, SecurityScheme> | undefined>)[SCHEMES_META];
    const guard = guards?.[oauth.scheme];
    if (guard === undefined) {
        throw new Error(`No guard registered for security scheme "${oauth.scheme}" required by the MCP plugin's oauth configuration.`);
    }
    const schemeDefinition = schemes?.[oauth.scheme];
    if (schemeDefinition === undefined) {
        throw new Error(`No identity named "${oauth.scheme}" is registered for the MCP plugin's oauth configuration.`);
    }
    return {
        oauth,
        guard,
        schemeDefinition,
        metadata: buildProtectedResourceMetadata({
            resource: oauth.resource,
            scheme: schemeDefinition,
        }),
        metadataUrl: protectedResourceMetadataUrl(oauth, endpointPath),
        scopesSupported: declaredScopes(schemeDefinition),
        // Every tool, both origins. A name missing from this map would be
        // challenged with no scopes at all, which is how a declared tool used to
        // slip past the scope check entirely.
        tools: new Map(
            buildDeclaredToolDefinitions(contractOf<Contract | undefined>(api)?.tools, { onlyReadOnly }).map((definition) => [
                definition.name,
                definition,
            ])
        ),
    };
};

/**
 * The oauth scheme's requirement for the tool a `tools/call` body names, so
 * the challenge speaks about the operation the client is attempting.
 */
const toolCallTarget = (
    body: unknown,
    enforcement: OAuthEnforcement
): { scopes: readonly string[]; accessGate: RouteDefinition['accessGate']; params: Record<string, string> } => {
    if (body !== null && typeof body === 'object' && (body as { method?: unknown }).method === 'tools/call') {
        const callParams = (body as { params?: { name?: unknown; arguments?: { params?: unknown } } }).params;
        const definition = typeof callParams?.name === 'string' ? enforcement.tools.get(callParams.name) : undefined;
        if (definition !== undefined) {
            const { requirements, accessGate } = toolRequirements(definition);
            const requirement = requirements.find((candidate) => candidate.scheme === enforcement.oauth.scheme);
            const routeParams = callParams?.arguments?.params;
            return {
                scopes: requirement?.scopes ?? [],
                accessGate: requirement === undefined ? undefined : accessGate,
                params: routeParams !== null && typeof routeParams === 'object' ? (routeParams as Record<string, string>) : {},
            };
        }
    }
    return {
        scopes: [],
        accessGate: undefined,
        params: {},
    };
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
    implementPlugin(mcpPlugin, ({ props, api }) => {
        const serverApi = api as ApiWithRouter;
        const enforcement =
            props.oauth === undefined ? undefined : prepareOAuth(props.oauth, props.path ?? '/mcp', serverApi, props.onlyReadOnly);

        return {
            router: {
                endpoint: async (args: HandlerArgs) => {
                    let transportAuth: { scheme: string; context?: Record<string, unknown> } | undefined;
                    if (enforcement !== undefined) {
                        const target = toolCallTarget(args.body, enforcement);
                        const outcome = await enforceOAuth({
                            scheme: enforcement.oauth.scheme,
                            guard: enforcement.guard,
                            schemeDefinition: enforcement.schemeDefinition,
                            metadataUrl: enforcement.metadataUrl,
                            scopesSupported: enforcement.scopesSupported,
                            scopes: target.scopes,
                            accessGate: target.accessGate,
                            params: target.params,
                            headers: args.headers,
                            handlerContext: adapterContextOf(args),
                        });
                        if (!outcome.ok) return denialResponse(outcome.denial);
                        transportAuth = {
                            scheme: enforcement.oauth.scheme,
                            ...(outcome.context === undefined
                                ? {}
                                : {
                                      context: outcome.context,
                                  }),
                        };
                    }

                    const handler = createMcpHandler(() =>
                        createMcpServer(serverApi, {
                            ...props,
                            handlerContext: adapterContextOf(args),
                            credentialHeaders: args.headers,
                            ...(transportAuth === undefined
                                ? {}
                                : {
                                      transportAuth,
                                  }),
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
                ...(enforcement === undefined
                    ? {}
                    : {
                          protectedResourceMetadata: () =>
                              rawResponse(
                                  new Response(JSON.stringify(enforcement.metadata), {
                                      status: 200,
                                      headers: {
                                          'content-type': 'application/json',
                                      },
                                  })
                              ),
                      }),
            },
        };
    });
