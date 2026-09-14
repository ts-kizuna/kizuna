import { z } from 'zod';
import {
    flattenTools,
    isCompiledTool,
    toolAt,
    type CompiledTool,
    type FlattenedTool,
    type ToolAnnotations,
    type ToolDefinition,
    type ToolHandlers,
    type ToolOutputValue,
    type Tools,
} from './tools.js';
import { toToolName } from './tool-name.js';
import type { ToolCall, ToolError, ToolKeys, ToolResult } from './tool-events.js';
import type { RequiredPermissions, RouteDefinition, SecurityRequirement } from './types.js';
import { resolveResponseBody } from './generator-utils.js';
import { problemDetails } from './problem-details.js';
import { isVoidSchema } from './zod-internals.js';
import { toToolEnvelope } from './tool-projection.js';
import { requiresDenial } from './access-check.js';

/**
 * The arguments a tool takes when run in code: its input when it declares one,
 * nothing otherwise.
 */
export type ToolRunArgs<Tool extends CompiledTool> = Tool['definition'] extends {
    input: z.ZodType;
}
    ? [input: z.input<Tool['definition']['input']>]
    : [];

/**
 * What a tool resolves to once its output has been validated.
 */
export type ToolRunReturn<Definition extends ToolDefinition> = ToolOutputValue<Definition>;

export interface ToolFn<Tool extends CompiledTool> {
    /**
     * Validate the input, run the handler, validate what it returned.
     */
    run: (...args: ToolRunArgs<Tool>) => Promise<ToolRunReturn<Tool['definition']>>;
}

/**
 * A contract's tools, shaped exactly like the declaration.
 */
export type ToolTree<Tools_ extends Tools> = {
    [Name in keyof Tools_]: Tools_[Name] extends CompiledTool
        ? ToolFn<Tools_[Name]>
        : Tools_[Name] extends Tools
          ? ToolTree<Tools_[Name]>
          : never;
};

/**
 * One tool resolved for a model: the name it answers to, alongside everything
 * that describes it. The schemas stay as Zod, because MCP's own SDK converts
 * them differently from a model-facing list.
 */
export interface ResolvedTool {
    /**
     * The name a model calls it by, e.g. `weather_get_forecast`.
     */
    name: string;
    /**
     * The dotted key the rest of kizuna addresses the tool by.
     */
    toolKey: string;
    title: string | undefined;
    description: string;
    input: z.ZodType | undefined;
    output: z.ZodType | undefined;
    annotations: ToolAnnotations | undefined;
    /**
     * The identity whose context the handler receives.
     */
    identity: string | undefined;
    /**
     * Who may call it, in the shape a route carries. A tool running a route has
     * none of its own.
     */
    security: readonly SecurityRequirement[] | undefined;
    /**
     * The roles the tool accepts, and the permissions it requires. A tool
     * running a route has none of its own.
     */
    roles: readonly string[] | undefined;
    requires: RequiredPermissions | undefined;
    /**
     * The route this tool runs, when it was named with `toolFromRoutes`. That
     * route's own access control says who may call the tool.
     */
    route: RouteDefinition | undefined;
    /**
     * The tags its route inherits.
     */
    routeTags: readonly string[] | undefined;
}

/**
 * A JSON Schema describing an object, the shape MCP requires of a tool's
 * `inputSchema`. Spelled out so a provider SDK's tool type takes it without a
 * cast.
 */
export interface JsonSchemaObject {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
    [key: string]: unknown;
}

/**
 * One tool in MCP's `Tool` shape, with its schemas as JSON Schema. What a model
 * is given.
 */
export interface ModelFacingTool {
    name: string;
    title?: string;
    description: string;
    inputSchema: JsonSchemaObject;
    /**
     * Any JSON Schema. A result is not required to be an object, so this is
     * wider than {@link ModelFacingTool.inputSchema}.
     */
    outputSchema?: Record<string, unknown>;
    annotations?: ToolAnnotations;
}

/**
 * A contract's tools bound to their handlers.
 *
 * @example
 * await tools.weather.getForecast.run({ city: 'Oslo' });
 */
export type ToolRunner<Tools_ extends Tools> = ToolTree<Tools_> & {
    /**
     * Run the tool one `tool_call` payload names and resolve to the matching
     * `tool_result` payload, ready to yield back onto the stream.
     *
     * Takes the input side of each tool's schema, so a field with a `.default()`
     * may be left out.
     */
    call: <const Call extends ToolCall<Tools_, 'input'>>(
        call: Call
    ) => Promise<Extract<ToolResult<Tools_, 'output'>, { name: Call['name'] }>>;
    /**
     * Run a call whose name and input are not known to be valid, the shape a
     * model hands you. Nothing throws: an unknown name or input that fails its
     * schema comes back as `{ ok: false }` carrying the sentence to show the
     * model.
     *
     * `name` takes either the dotted key or the published MCP name.
     *
     * @example
     * const outcome = await tools.dispatch({
     *     id: block.id,
     *     name: block.name,
     *     input: block.input,
     * });
     */
    dispatch: (call: UntrustedToolCall) => Promise<ToolDispatchOutcome<Tools_>>;
    /**
     * Run a call and yield the `tool_call` event, then either `tool_result` or
     * `tool_error`, in the order a stream wants them. Nothing throws.
     *
     * @example
     * yield* tools.emit({
     *     id: block.id,
     *     name: block.name,
     *     input: block.input,
     * });
     */
    emit: (call: UntrustedToolCall) => AsyncGenerator<ToolEventMessage<Tools_>, void, undefined>;
    /**
     * Every tool in MCP's `Tool` shape, with `inputSchema` as JSON Schema. This
     * is what a model is given.
     */
    definitions: ModelFacingTool[];
    /**
     * The dotted key behind a published tool name.
     */
    keyOf: (publishedName: string) => ToolKeys<Tools_>;
};

/**
 * Verified identity context, keyed by scheme name, exactly as a route handler
 * receives it under `auth`.
 */
export type BoundToolAuth = Record<string, unknown>;

/**
 * What a request has already resolved, handed to a tool's handler. An adapter
 * binds it before a handler sees `tools`.
 */
export interface BoundToolContext {
    /**
     * Verified identity context, keyed by scheme.
     */
    auth?: BoundToolAuth;
    /**
     * What the contract's request-context providers resolved, keyed by provider.
     */
    requestContext?: Record<string, unknown>;
}

/**
 * Where a runner keeps its rebind. A symbol rather than a name, so a handler
 * holding `tools` cannot reach it. Binding grants a caller rather than checking
 * one.
 */
const BIND: unique symbol = Symbol('ts-kizuna.tools.bind');

/**
 * Bind an identity an adapter has already verified, for the one request it
 * verified it on.
 *
 * To build a runner of your own, pass the auth to {@link createToolRunner}
 * instead.
 */
export const bindToolRunner = <Tools_ extends Tools>(runner: ToolRunner<Tools_>, bound: BoundToolContext): ToolRunner<Tools_> =>
    (runner as unknown as Record<typeof BIND, (given: BoundToolContext) => ToolRunner<Tools_>>)[BIND](bound);

/**
 * Runs the route behind a tool named with `toolFromRoutes`.
 *
 * Injected rather than imported, because running a route needs the adapter and
 * the runner rides on the contract, which a browser bundles.
 */
export type RouteToolExecutor = (call: {
    toolKey: string;
    routeKey: string;
    route: RouteDefinition;
    input: unknown;
    auth: BoundToolAuth | undefined;
}) => Promise<unknown>;

/**
 * A call as it arrives from a model: a name that may not be a tool, and input
 * that has not been validated.
 */
export interface UntrustedToolCall {
    /**
     * Correlates the call with its result. Generated when left out.
     */
    id?: string;
    name: string;
    input?: unknown;
}

/**
 * A call {@link ToolRunner.dispatch} could not complete. `name` stays a plain
 * string, because an unknown name is one of the reasons.
 */
export interface ToolDispatchFailure {
    ok: false;
    id: string;
    name: string;
    /**
     * The sentence to show the model, so it can correct itself and retry.
     */
    message: string;
}

/**
 * What {@link ToolRunner.dispatch} answers, the success arm discriminated on
 * `name`.
 */
export type ToolDispatchOutcome<Tools_ extends Tools> =
    | ({
          ok: true;
      } & ToolResult<Tools_, 'output'>)
    | ToolDispatchFailure;

/**
 * One of the three events a tool call puts on a stream, named the way a
 * streamed response declares them.
 */
export type ToolEventMessage<Tools_ extends Tools> =
    | {
          event: 'tool_call';
          data: ToolCall<Tools_, 'output'>;
      }
    | {
          event: 'tool_result';
          data: ToolResult<Tools_, 'output'>;
      }
    | {
          event: 'tool_error';
          data: ToolError<Tools_>;
      };

export class ToolInputError extends Error {
    readonly tool: string;
    readonly issues: z.core.$ZodIssue[];

    constructor(tool: string, issues: z.core.$ZodIssue[]) {
        super(`Input for tool "${tool}" failed validation.`);
        this.name = 'ToolInputError';
        this.tool = tool;
        this.issues = issues;
    }
}

export class ToolOutputError extends Error {
    readonly tool: string;
    readonly issues: z.core.$ZodIssue[];

    constructor(tool: string, issues: z.core.$ZodIssue[]) {
        super(`Output of tool "${tool}" failed validation.`);
        this.name = 'ToolOutputError';
        this.tool = tool;
        this.issues = issues;
    }
}

const isErrorStatus = (status: number): boolean => status >= 400;

/**
 * Complete the RFC 9457 envelope a handler only wrote `detail` for.
 */
const fillProblemDetails = (status: number, body: unknown): unknown => {
    if (!body || typeof body !== 'object') return body;
    const given = body as Record<string, unknown>;
    return {
        ...problemDetails(status, typeof given['detail'] === 'string' ? given['detail'] : ''),
        ...given,
        status,
    };
};

/**
 * The `{ status, body }` a tool answers with.
 */
export interface ToolEnvelope {
    status: number;
    body?: unknown;
    detail?: string;
}

/**
 * Fill in the `204` a handler left off.
 */
export const toToolResponse = (result: unknown): unknown =>
    result === undefined
        ? {
              status: 204,
          }
        : result;

/**
 * What `throwError` raises: the response the handler chose.
 */
export class ToolResponseError extends Error {
    readonly tool: string;
    readonly response: ToolEnvelope;

    constructor(tool: string, response: ToolEnvelope) {
        super(`Tool "${tool}" answered with ${response.status}.`);
        this.name = 'ToolResponseError';
        this.tool = tool;
        this.response = response;
    }
}

/**
 * A handler read what a request resolves, on a runner nothing bound it to.
 */
export class ToolRequestContextError extends Error {
    readonly tool: string;

    constructor(tool: string, names: readonly string[]) {
        super(
            `Tool "${tool}" reads request context, and nothing has been bound. ` +
                `Adapters bind it before a handler sees \`tools\`; outside a request, pass ` +
                `\`{ requestContext: { ${names.join(', ')} } }\` when you build the runner.`
        );
        this.name = 'ToolRequestContextError';
        this.tool = tool;
    }
}

/**
 * A tool ran the route behind it without the identity that route requires. A
 * tool carries the caller it was given rather than authenticating one, so this
 * is a mistake in the caller rather than a denial.
 */
export class ToolIdentityError extends Error {
    readonly tool: string;
    readonly identity: string;

    constructor(tool: string, identity: string) {
        super(
            `Tool "${tool}" requires the "${identity}" identity, and nothing has been bound. ` +
                `Adapters bind the calling route's own identity; outside a request, pass one to \`createToolRunner\`.`
        );
        this.name = 'ToolIdentityError';
        this.tool = tool;
        this.identity = identity;
    }
}

/**
 * What `throwError` raises: the sentence the model reads, and the tool that
 * produced it.
 */
export class ToolExecutionError extends Error {
    readonly tool: string;

    constructor(tool: string, message: string) {
        super(message);
        this.name = 'ToolExecutionError';
        this.tool = tool;
    }
}

/**
 * One Zod issue as a model reads it: the field it is about, then what is wrong.
 */
const describeIssue = (issue: z.core.$ZodIssue): string => {
    const field = issue.path.map((segment) => String(segment)).join('.');
    return field === '' ? issue.message : `${field}: ${issue.message}`;
};

/**
 * Why a dispatched call failed, in the sentence the model reads. An input
 * failure names the fields so the model can correct them. An output failure says
 * the tool broke, rather than leaking its schema.
 */
const dispatchMessage = (toolKey: string, error: unknown): string => {
    if (error instanceof ToolExecutionError) return error.message;
    if (error instanceof ToolIdentityError) {
        return `Tool "${toolKey}" is not available to this caller.`;
    }
    if (error instanceof ToolRequestContextError) {
        return `Tool "${toolKey}" could not run.`;
    }
    if (error instanceof ToolInputError) {
        return `Input for "${toolKey}" is not valid. ${error.issues.map(describeIssue).join('; ')}`;
    }
    if (error instanceof ToolOutputError) {
        return `Tool "${toolKey}" returned something its own schema rejects. This is a fault in the tool, not in the call.`;
    }
    return error instanceof Error ? error.message : `Tool "${toolKey}" failed.`;
};

/**
 * MCP asks for an object schema even when a tool takes nothing, and this is the
 * form it recommends.
 */
const NO_ARGUMENTS: JsonSchemaObject = {
    type: 'object',
    additionalProperties: false,
};

/**
 * `cycles: 'throw'` because a self-referential schema converts to `{ $ref: '#' }`,
 * and Gemini and Vertex reject any `$ref` in a tool schema. Failing here names
 * the tool.
 */
const toJsonSchema = (schema: z.ZodType, io: 'input' | 'output'): Record<string, unknown> =>
    z.toJSONSchema(schema, {
        unrepresentable: 'any',
        cycles: 'throw',
        io,
    }) as Record<string, unknown>;

/**
 * MCP requires a tool's arguments to be described by an object schema. A tool
 * declaring anything else is caught when the runner is built.
 */
const toArgumentSchema = (schema: z.ZodType, toolKey: string): JsonSchemaObject => {
    const converted = toJsonSchema(schema, 'input');
    if (converted['type'] !== 'object') {
        throw new Error(
            `Tool "${toolKey}" declares an \`input\` that is not an object, so it converts to a JSON Schema of type ` +
                `"${String(converted['type'])}". MCP describes a tool's arguments with an object schema, so wrap it in \`z.object({ ... })\`.`
        );
    }
    return converted as JsonSchemaObject;
};

/**
 * Resolve a tool tree for a model: the name each one answers to, and the
 * declaration behind it. Both `tools.definitions` and the MCP plugin build on
 * this.
 */
export const resolveTools = (tools: FlattenedTool[]): ResolvedTool[] =>
    tools.map(({ toolKey, tool }) => ({
        name: toToolName(toolKey),
        toolKey,
        title: tool.definition.title,
        description: tool.definition.description,
        input: tool.input,
        output: tool.output,
        annotations: tool.definition.annotations,
        identity: tool.identity,
        security: tool.security,
        roles: tool.roles,
        requires: tool.requires,
        route: tool.route,
        routeTags: tool.routeTags,
    }));

/**
 * Every tool in MCP's `Tool` shape, schemas converted to JSON Schema. Backs
 * `tools.definitions`.
 */
export const modelFacingTools = (tools: Tools): ModelFacingTool[] =>
    resolveTools(flattenTools(tools)).map((published) => ({
        name: published.name,
        ...(published.title === undefined ? {} : { title: published.title }),
        description: published.description,
        inputSchema: published.input ? toArgumentSchema(published.input, published.toolKey) : NO_ARGUMENTS,
        ...(published.output === undefined ? {} : { outputSchema: toJsonSchema(published.output, 'output') }),
        ...(published.annotations === undefined ? {} : { annotations: published.annotations }),
    }));

const handlerAt = (handlers: unknown, toolKey: string): unknown => {
    let current: unknown = handlers;
    for (const segment of toolKey.split('.')) {
        if (!current || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[segment];
    }
    return current;
};

/**
 * Pair a contract's tools with their handlers so they can be run from anywhere.
 *
 * Every handler already receives this as `tools`, so reach for it directly only
 * outside a request: in a script, a seed, or a test.
 */
export const createToolRunner = <Tools_ extends Tools, Identities = Record<string, never>>(
    source:
        | Tools_
        | {
              tools?: Tools_;
          },
    handlers: ToolHandlers<Tools_, Identities>,
    /**
     * What this request has already resolved. A tool requiring an identity
     * cannot run without the matching entry.
     */
    bound?: BoundToolContext,
    /**
     * Runs the route behind a `toolFromRoutes` tool.
     */
    runRoute?: RouteToolExecutor,
    /**
     * The request-context providers the contract declares, so a handler reading
     * them on an unbound runner fails by name.
     */
    requestContextNames?: readonly string[]
): ToolRunner<Tools_> => {
    const tools = (source && 'tools' in source ? ((source.tools ?? {}) as Tools_) : (source as Tools_)) ?? ({} as Tools_);

    const toolFor = (toolKey: string): CompiledTool => {
        const tool = toolAt(tools, toolKey);
        if (!tool) throw new Error(`No tool named "${toolKey}" on this contract.`);
        return tool;
    };

    /**
     * The `auth` a tool's handler receives. A tool declaring one refuses to run
     * unbound, rather than let a handler read a selector out of the input a
     * model chose.
     */
    const authFor = (toolKey: string, tool: CompiledTool): Record<string, unknown> | undefined => {
        const requirements = tool.security ?? [];
        if (requirements.length === 0) return undefined;

        const context: Record<string, unknown> = {};
        const requiredSchemes: string[] = [];
        for (const entry of requirements) {
            const schemes = typeof entry === 'string' ? [entry] : Object.keys(entry);
            for (const scheme of schemes) {
                const given = bound?.auth?.[scheme];
                if (given === undefined) throw new ToolIdentityError(toolKey, scheme);
                requiredSchemes.push(scheme);
                context[scheme] = given;
            }
        }
        const forbidden = requiresDenial({
            roles: tool.roles,
            requires: tool.requires,
            requiredSchemes,
            schemes: undefined,
            securityContext: context,
        });
        if (forbidden !== undefined) throw new ToolExecutionError(toolKey, forbidden);
        return context;
    };

    /**
     * What the request resolved, when there is any. A contract declaring
     * providers with nothing bound throws by name, rather than a `TypeError`
     * from inside the handler.
     */
    const requestContextOf = (toolKey: string): { requestContext: Record<string, unknown> } | undefined => {
        const given = bound?.requestContext;
        if (given !== undefined && Object.keys(given).length > 0) {
            return {
                requestContext: given,
            };
        }
        if (requestContextNames !== undefined && requestContextNames.length > 0) {
            throw new ToolRequestContextError(toolKey, requestContextNames);
        }
        return undefined;
    };

    /**
     * Check a handler's return against the schema the status it chose declares.
     */
    const validateEnvelope = (toolKey: string, tool: CompiledTool, envelope: ToolEnvelope): ToolEnvelope => {
        const declared = tool.responses[envelope.status];
        if (declared === undefined) {
            throw new ToolOutputError(toolKey, [
                {
                    code: 'custom',
                    path: ['status'],
                    message:
                        `Tool "${toolKey}" answered with ${envelope.status}, which it does not declare. ` +
                        `List it under \`failures\`, or answer one of ${Object.keys(tool.responses).join(', ')}.`,
                } as z.core.$ZodIssue,
            ]);
        }
        const body = resolveResponseBody(declared);
        if (body === undefined || isVoidSchema(body)) {
            return {
                status: envelope.status,
            };
        }
        // A handler writes `detail` and leaves the rest of RFC 9457 to us.
        const given = isErrorStatus(envelope.status) ? fillProblemDetails(envelope.status, envelope.body) : envelope.body;
        const parsed = body.safeParse(given);
        if (!parsed.success) throw new ToolOutputError(toolKey, parsed.error.issues);
        return toToolEnvelope(envelope.status, parsed.data);
    };

    const invoke = async (toolKey: string, input: unknown): Promise<unknown> => {
        const tool = toolFor(toolKey);

        if (tool.route !== undefined) {
            if (runRoute === undefined || tool.routeKey === undefined) {
                throw new Error(
                    `Tool "${toolKey}" runs the route "${tool.routeKey ?? tool.route.path}", and this runner was built without one. ` +
                        `Reach it through the api rather than by calling \`createToolRunner\` directly.`
                );
            }
            return runRoute({
                toolKey,
                routeKey: tool.routeKey,
                route: tool.route,
                input,
                auth: bound?.auth,
            });
        }

        const handler = handlerAt(handlers, toolKey);
        if (typeof handler !== 'function') throw new Error(`No handler was bound for tool "${toolKey}".`);

        const auth = authFor(toolKey, tool);

        let validatedInput: unknown = undefined;
        if (tool.input) {
            const parsed = tool.input.safeParse(input);
            if (!parsed.success) throw new ToolInputError(toolKey, parsed.error.issues);
            validatedInput = parsed.data;
        }

        let returned: unknown;
        try {
            returned = await (handler as (args: unknown) => unknown)({
                input: validatedInput,
                throwError: (response: unknown): never => {
                    throw new ToolResponseError(toolKey, toToolResponse(response) as ToolEnvelope);
                },
                ...(auth === undefined
                    ? {}
                    : {
                          auth,
                      }),
                ...(requestContextOf(toolKey) ?? {}),
            });
        } catch (error) {
            if (error instanceof ToolResponseError) return validateEnvelope(toolKey, tool, error.response);
            throw error;
        }

        return validateEnvelope(toolKey, tool, toToolResponse(returned) as ToolEnvelope);
    };

    const buildTree = (nodes: Tools, prefix: string): Record<string, unknown> => {
        const result: Record<string, unknown> = {};
        for (const [name, node] of Object.entries(nodes)) {
            const toolKey = prefix ? `${prefix}.${name}` : name;
            if (isCompiledTool(node)) {
                result[name] = {
                    run: (input?: unknown) => invoke(toolKey, input),
                };
            } else if (node && typeof node === 'object') {
                result[name] = buildTree(node as Tools, toolKey);
            }
        }
        return result;
    };

    const keys = new Map(flattenTools(tools).map(({ toolKey }) => [toToolName(toolKey), toolKey]));

    const tree = buildTree(tools, '') as Record<string, unknown>;

    tree['call'] = async (call: { id: string; name: string; input?: unknown }) => {
        const tool = toolFor(call.name);
        const output = await invoke(call.name, call.input);
        return {
            id: call.id,
            name: call.name,
            output,
        };
    };

    /**
     * The dotted key a name refers to, taking either spelling, or `undefined`
     * when it names no tool on this contract.
     */
    const resolveName = (name: string): string | undefined => (toolAt(tools, name) ? name : keys.get(name));

    let dispatched = 0;

    const nextId = (given: string | undefined): string => given ?? `tool_${(dispatched += 1)}`;

    const unknownName = (name: string): string => `No tool named "${name}". The tools available are: ${[...keys.keys()].join(', ')}.`;

    tree['dispatch'] = async (call: UntrustedToolCall) => {
        const id = nextId(call.id);
        const toolKey = resolveName(call.name);
        if (toolKey === undefined) {
            return {
                ok: false,
                id,
                name: call.name,
                message: unknownName(call.name),
            };
        }

        try {
            const tool = toolFor(toolKey);
            const output = await invoke(toolKey, call.input);
            return {
                ok: true,
                id,
                name: toolKey,
                output,
            };
        } catch (error) {
            return {
                ok: false,
                id,
                name: toolKey,
                message: dispatchMessage(toolKey, error),
            };
        }
    };

    tree['emit'] = async function* (call: UntrustedToolCall) {
        const id = nextId(call.id);
        const toolKey = resolveName(call.name);

        // The call goes out before the work starts, so a client can show it running.
        yield {
            event: 'tool_call',
            data: {
                id,
                name: toolKey ?? call.name,
                ...(call.input === undefined ? {} : { input: call.input }),
            },
        };

        if (toolKey === undefined) {
            yield {
                event: 'tool_error',
                data: {
                    id,
                    name: call.name,
                    message: unknownName(call.name),
                },
            };
            return;
        }

        try {
            const tool = toolFor(toolKey);
            const output = await invoke(toolKey, call.input);
            yield {
                event: 'tool_result',
                data: {
                    id,
                    name: toolKey,
                    output,
                },
            };
        } catch (error) {
            yield {
                event: 'tool_error',
                data: {
                    id,
                    name: toolKey,
                    message: dispatchMessage(toolKey, error),
                },
            };
        }
    };

    (tree as Record<typeof BIND, unknown>)[BIND] = (given: BoundToolContext) =>
        createToolRunner(
            source,
            handlers,
            {
                auth: {
                    ...bound?.auth,
                    ...given.auth,
                },
                requestContext: {
                    ...bound?.requestContext,
                    ...given.requestContext,
                },
            },
            runRoute,
            requestContextNames
        );

    tree['definitions'] = modelFacingTools(tools);

    tree['keyOf'] = (publishedName: string): string => {
        const toolKey = keys.get(publishedName);
        if (toolKey === undefined) {
            throw new Error(
                `No tool publishes as "${publishedName}". The names this contract publishes are: ${[...keys.keys()].join(', ')}.`
            );
        }
        return toolKey;
    };

    return tree as ToolRunner<Tools_>;
};

/**
 * The `tools` argument every handler receives: the contract's tools bound to
 * their handlers. Absent when the contract declares none.
 */
export type ToolsArg<Tools_ extends Tools> = string extends keyof Tools_
    ? {}
    : {
          tools: ToolRunner<Tools_>;
      };
