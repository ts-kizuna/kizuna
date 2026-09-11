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
    type Tools,
} from './tools.js';
import { toToolName } from './tool-name.js';
import type { ToolCall, ToolError, ToolKeys, ToolResult } from './tool-events.js';
import type { RouteDefinition } from './types.js';

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
export type ToolRunReturn<Definition extends ToolDefinition> = Definition extends {
    output: z.ZodType;
}
    ? z.output<Definition['output']>
    : void;

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
 * One tool resolved for publication: its MCP name alongside everything a
 * publisher needs. The schemas stay as Zod, because MCP's own SDK converts
 * them and a model-facing list converts them differently.
 */
export interface PublishedTool {
    /**
     * The MCP name, e.g. `weather_get_forecast`.
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
     * Always `undefined`. Authorization comes from the route a tool runs.
     */
    identity: string | undefined;
    /**
     * The route this tool runs, when it was named with `k.tools.fromRoute`. Its
     * own `security` and `accessGate` say who may call the tool.
     */
    route: RouteDefinition | undefined;
    /**
     * The tags its route inherits, for grouping a model's overview.
     */
    routeTags: readonly string[] | undefined;
}

/**
 * A JSON Schema describing an object, the shape MCP requires of a tool's
 * `inputSchema`. Spelled out rather than left as a bare record so a provider
 * SDK's own tool type accepts it without a cast.
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
     * `tool_result` payload, ready to yield straight back onto the stream.
     *
     * Takes the input side of each tool's schema, so a field with a `.default()`
     * may be left out, exactly as `run` and the `tool_call` event accept it.
     */
    call: <const Call extends ToolCall<Tools_, 'input'>>(
        call: Call
    ) => Promise<Extract<ToolResult<Tools_, 'output'>, { name: Call['name'] }>>;
    /**
     * Run a call whose name and input are not known to be valid, the shape a
     * model hands you. Nothing throws: an unknown name, input that fails its
     * schema, and a `throwError` from the handler all come back as
     * `{ ok: false }` carrying the sentence to show the model.
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
     * A runner bound to an identity this request already verified, keyed by
     * scheme. Every adapter does this for you before a handler sees `tools`, so
     * reach for it only outside a request: in a script, a seed, or a job.
     *
     * @example
     * const asMember = tools.as({ member: { workspaceId: 'w_1', role: 'owner' } });
     */
    as: (auth: BoundToolAuth) => ToolRunner<Tools_>;
    /**
     * The dotted key behind a published tool name, so a name the model chose
     * becomes the key the rest of kizuna addresses a tool by.
     */
    keyOf: (publishedName: string) => ToolKeys<Tools_>;
};

/**
 * Verified identity context, keyed by scheme name, exactly as a route handler
 * receives it under `auth`.
 */
export type BoundToolAuth = Record<string, unknown>;

/**
 * Runs the route behind a tool named with `k.tools.fromRoute`, answering its
 * `{ status, body }` envelope.
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
 * string, because an unknown name is one of the reasons to be here.
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
 * What {@link ToolRunner.dispatch} answers. The success arm is the tool's own
 * `tool_result` payload, discriminated on `name`.
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

/**
 * A tool ran the route behind it without the identity that route requires. A
 * tool never authenticates: it carries the caller it was given, so an unbound
 * call is a mistake in the caller rather than a denial.
 */
export class ToolIdentityError extends Error {
    readonly tool: string;
    readonly identity: string;

    constructor(tool: string, identity: string) {
        super(
            `Tool "${tool}" runs a route that requires the "${identity}" identity, and nothing has been bound. ` +
                `Adapters bind the calling route's own identity; outside a request, bind one with \`tools.as({ ${identity}: ... })\`.`
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
 * Why a dispatched call failed, in the sentence the model reads. Input failures
 * name the fields, so the model can correct them and try again; an output
 * failure is the tool's fault, so it says that rather than leaking the schema.
 */
const dispatchMessage = (toolKey: string, error: unknown): string => {
    if (error instanceof ToolExecutionError) return error.message;
    if (error instanceof ToolIdentityError) {
        return `Tool "${toolKey}" is not available to this caller.`;
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
 * the tool; failing at one provider's API does not.
 */
const toJsonSchema = (schema: z.ZodType, io: 'input' | 'output'): Record<string, unknown> =>
    z.toJSONSchema(schema, {
        unrepresentable: 'any',
        cycles: 'throw',
        io,
    }) as Record<string, unknown>;

/**
 * MCP requires a tool's arguments to be described by an object schema, so a
 * tool declaring anything else is caught when the runner is built rather than
 * when a model calls it.
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
 * Resolve tools for publication: the MCP name, and the declaration behind it.
 * Both `tools.definitions` and the MCP plugin build on this, so a tool is
 * named and described in exactly one place.
 */
export const publishedTools = (tools: FlattenedTool[]): PublishedTool[] =>
    tools.map(({ toolKey, tool }) => ({
        name: toToolName(toolKey),
        toolKey,
        title: tool.definition.title,
        description: tool.definition.description,
        input: tool.input,
        output: tool.output,
        annotations: tool.definition.annotations,
        identity: tool.identity,
        route: tool.route,
        routeTags: tool.routeTags,
    }));

/**
 * Every tool in MCP's `Tool` shape, schemas converted to JSON Schema. Backs
 * `tools.definitions`.
 */
export const publishTools = (tools: Tools): ModelFacingTool[] =>
    publishedTools(flattenTools(tools)).map((published) => ({
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
export const createToolRunner = <Tools_ extends Tools>(
    source:
        | Tools_
        | {
              tools?: Tools_;
          },
    handlers: ToolHandlers<Tools_>,
    /**
     * Identity context already verified for this request, keyed by scheme. A
     * tool requiring an identity cannot run without the matching entry.
     */
    boundAuth?: BoundToolAuth,
    /**
     * Runs the route behind a `k.tools.fromRoute` tool. Without one, such a
     * tool has no way to answer.
     */
    runRoute?: RouteToolExecutor
): ToolRunner<Tools_> => {
    const tools = (source && 'tools' in source ? ((source.tools ?? {}) as Tools_) : (source as Tools_)) ?? ({} as Tools_);

    const toolFor = (toolKey: string): CompiledTool => {
        const tool = toolAt(tools, toolKey);
        if (!tool) throw new Error(`No tool named "${toolKey}" on this contract.`);
        return tool;
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
                auth: boundAuth,
            });
        }

        const handler = handlerAt(handlers, toolKey);
        if (typeof handler !== 'function') throw new Error(`No handler was bound for tool "${toolKey}".`);

        let validatedInput: unknown = undefined;
        if (tool.input) {
            const parsed = tool.input.safeParse(input);
            if (!parsed.success) throw new ToolInputError(toolKey, parsed.error.issues);
            validatedInput = parsed.data;
        }

        const returned = await (handler as (args: unknown) => unknown)({
            input: validatedInput,
            throwError: (message: string): never => {
                throw new ToolExecutionError(toolKey, message);
            },
        });

        if (!tool.output) return undefined;
        const parsed = tool.output.safeParse(returned);
        if (!parsed.success) throw new ToolOutputError(toolKey, parsed.error.issues);
        return parsed.data;
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
            ...(tool.output ? { output } : {}),
        };
    };

    /**
     * The dotted key a name refers to, taking either spelling, or `undefined`
     * when it names no tool on this contract.
     */
    const resolveName = (name: string): string | undefined => (toolAt(tools, name) ? name : keys.get(name));

    let dispatched = 0;

    tree['dispatch'] = async (call: UntrustedToolCall) => {
        const id = call.id ?? `tool_${(dispatched += 1)}`;
        const toolKey = resolveName(call.name);
        if (toolKey === undefined) {
            const published = [...keys.keys()].join(', ');
            return {
                ok: false,
                id,
                name: call.name,
                message: `No tool named "${call.name}". The tools available are: ${published}.`,
            };
        }

        try {
            const tool = toolFor(toolKey);
            const output = await invoke(toolKey, call.input);
            return {
                ok: true,
                id,
                name: toolKey,
                ...(tool.output ? { output } : {}),
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
        const outcome = (await (tree['dispatch'] as (given: UntrustedToolCall) => Promise<ToolDispatchOutcome<Tools_>>)(
            call
        )) as ToolDispatchOutcome<Tools_> & {
            id: string;
            name: string;
        };

        yield {
            event: 'tool_call',
            data: {
                id: outcome.id,
                name: outcome.name,
                ...(call.input === undefined ? {} : { input: call.input }),
            },
        };

        if (outcome.ok) {
            const { ok: _ok, ...result } = outcome;
            yield {
                event: 'tool_result',
                data: result,
            };
            return;
        }

        yield {
            event: 'tool_error',
            data: {
                id: outcome.id,
                name: outcome.name,
                message: outcome.message,
            },
        };
    };

    tree['as'] = (auth: BoundToolAuth) =>
        createToolRunner(
            source,
            handlers,
            {
                ...boundAuth,
                ...auth,
            },
            runRoute
        );

    tree['definitions'] = publishTools(tools);

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
