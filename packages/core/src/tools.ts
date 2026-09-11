import { z } from 'zod';

/**
 * MCP's tool annotations, verbatim. A route derives these from its method's
 * RFC 9110 semantics; a tool has no method, so it declares them.
 *
 * MCP already defaults `destructiveHint` and `openWorldHint` to true, so the
 * hints worth setting are the ones that make a tool safer than that.
 */
export interface ToolAnnotations {
    /**
     * The tool only reads. It changes nothing the caller could observe later.
     */
    readOnlyHint?: boolean;
    /**
     * Calling the tool twice with the same input does what calling it once did.
     */
    idempotentHint?: boolean;
    /**
     * The tool may remove or overwrite something.
     */
    destructiveHint?: boolean;
    /**
     * The tool reaches something outside this API, such as the public internet.
     */
    openWorldHint?: boolean;
}

/**
 * A tool a model may call, as authored in `k.tools`. The fields mirror MCP's
 * `Tool`, so publishing one is a projection rather than a translation.
 */
export interface ToolDefinition {
    /**
     * A human-readable name for display. MCP's `title`.
     */
    title?: string;
    /**
     * What the tool does, in the words the model reads when it decides whether
     * to call it. Required, because a tool without one is not callable.
     */
    description: string;
    /**
     * Schema for the arguments the model sends. Becomes MCP's `inputSchema`.
     * Omit it for a tool that takes none.
     */
    input?: z.ZodType;
    /**
     * Schema for what the tool returns. Becomes MCP's `outputSchema`. Omit it
     * for a tool that reports nothing back.
     */
    output?: z.ZodType;
    /**
     * How the tool behaves, for a client deciding whether to ask before
     * calling it.
     */
    annotations?: ToolAnnotations;
}

/**
 * A tool after `k.tools` compiles it.
 */
export interface CompiledTool<
    Definition extends ToolDefinition = ToolDefinition,
    IdentityName extends string | undefined = string | undefined,
> {
    definition: Definition;
    /**
     * The identity every tool in the group requires, or `undefined` when the
     * group was declared without one. It is checked per call.
     */
    identity: IdentityName;
    /**
     * The argument schema, or `undefined` when the tool takes none.
     */
    input: z.ZodType | undefined;
    /**
     * The result schema, or `undefined` when the tool reports nothing.
     */
    output: z.ZodType | undefined;
}

/**
 * A contract's tools. Nestable, like routes, so a large codebase can group
 * them, `tools.weather.getForecast`.
 */
export interface Tools {
    [key: string]: CompiledTool | Tools;
}

/**
 * The shape `k.tools` accepts: tools, or groups of them, to any depth.
 */
export interface AuthoredTools {
    [key: string]: ToolDefinition | AuthoredTools;
}

/**
 * The compiled form of an authored tool tree, preserving its shape.
 */
export type CompiledTools<Definitions extends AuthoredTools, IdentityName extends string | undefined> = {
    [Name in keyof Definitions]: Definitions[Name] extends ToolDefinition
        ? CompiledTool<Definitions[Name], IdentityName>
        : Definitions[Name] extends AuthoredTools
          ? CompiledTools<Definitions[Name], IdentityName>
          : never;
};

/**
 * A tool tree with no tools in it, for a contract that declares none.
 */
export type NoTools = Record<string, never>;

/**
 * The single object a tool handler receives: its own input and `throwError`,
 * and nothing else. Anything more it imports, as a route handler would.
 */
export type ToolHandlerArgs<Definition extends ToolDefinition> = {
    /**
     * The validated arguments, or `undefined` when the tool declares no
     * `input`.
     */
    input: Definition extends {
        input: z.ZodType;
    }
        ? z.output<Definition['input']>
        : undefined;
    /**
     * Reports a failure the model can act on. A tool has no HTTP status, so
     * this takes the sentence the model reads, and nothing else.
     *
     * This function throws internally and never returns.
     */
    throwError: (message: string) => never;
};

/**
 * What a tool handler returns: its `output`, or nothing when it declares none.
 */
export type ToolHandlerReturn<Definition extends ToolDefinition> = Definition extends {
    output: z.ZodType;
}
    ? z.input<Definition['output']>
    : void;

export type ToolHandler<Tool extends CompiledTool> = (
    args: ToolHandlerArgs<Tool['definition']>
) => Promise<ToolHandlerReturn<Tool['definition']>> | ToolHandlerReturn<Tool['definition']>;

/**
 * The handlers `server.tools` accepts: one per declared tool, keyed by name.
 */
export type ToolHandlers<Tools_ extends Tools> = {
    [Name in keyof Tools_]: Tools_[Name] extends CompiledTool
        ? ToolHandler<Tools_[Name]>
        : Tools_[Name] extends Tools
          ? ToolHandlers<Tools_[Name]>
          : never;
};

/**
 * Every field a tool may declare. A node carrying only these, with a
 * `description`, is a tool; anything else is a group of them.
 */
const TOOL_FIELDS = ['title', 'description', 'input', 'output', 'annotations'] as const;

/**
 * Whether one field is shaped the way a tool declares it. Types are checked as
 * well as names, so a group named `title` still reads as a group.
 */
const isToolField = (name: string, value: unknown): boolean => {
    switch (name) {
        case 'title':
        case 'description':
            return typeof value === 'string';
        case 'input':
        case 'output':
            return value instanceof z.ZodType;
        case 'annotations':
            return !!value && typeof value === 'object';
        default:
            return false;
    }
};

/**
 * Whether a node in an authored tree is a tool rather than a group of them. A
 * tool is the node that describes itself, which is also the field a model
 * cannot do without.
 */
export const isToolDefinition = (value: unknown): value is ToolDefinition => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (typeof (value as { description?: unknown }).description !== 'string') return false;
    return Object.entries(value).every(([name, field]) => isToolField(name, field));
};

const assertValidTool = (toolKey: string, definition: ToolDefinition): void => {
    if (definition.description.trim() === '') {
        throw new Error(
            `Tool "${toolKey}" has an empty \`description\`. It is the only thing a model reads when it decides whether to call the tool.`
        );
    }
};

/**
 * Names the tool runner puts on the root of the tree, so a top-level tool or
 * group cannot take them.
 */
const RESERVED_ROOT_NAMES = ['call', 'dispatch', 'emit', 'definitions', 'keyOf'] as const;

/**
 * Compile authored tool definitions into {@link Tools}, preserving nesting.
 * Backs `k.tools`.
 */
export const buildTools = (identity: string | undefined, definitions: AuthoredTools): Tools => {
    for (const reserved of RESERVED_ROOT_NAMES) {
        if (reserved in definitions) {
            throw new Error(
                `Tool "${reserved}" cannot sit at the top level, because \`tools.${reserved}\` is how a handler reaches the runner. ` +
                    `Rename it, or nest it in a group.`
            );
        }
    }

    const walk = (nodes: AuthoredTools, prefix: string): Tools => {
        const tools: Tools = {};
        for (const [name, node] of Object.entries(nodes)) {
            const toolKey = prefix ? `${prefix}.${name}` : name;
            if (isToolDefinition(node)) {
                assertValidTool(toolKey, node);
                tools[name] = {
                    definition: node,
                    identity,
                    input: node.input,
                    output: node.output,
                } as unknown as CompiledTool;
                continue;
            }
            if (!node || typeof node !== 'object' || Array.isArray(node)) {
                throw new Error(
                    `Tool "${toolKey}" is not an object. A tool declares ${TOOL_FIELDS.join(', ')}; a group declares more tools.`
                );
            }
            tools[name] = walk(node as AuthoredTools, toolKey);
        }
        return tools;
    };

    return walk(definitions, '');
};

export const isCompiledTool = (value: unknown): value is CompiledTool => {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Record<string, unknown>;
    return 'definition' in candidate && 'identity' in candidate && 'input' in candidate && 'output' in candidate;
};

export interface FlattenedTool {
    /**
     * Dotted path to the tool, e.g. `weather.getForecast`. It is how every
     * other part of the system names a tool.
     */
    toolKey: string;
    tool: CompiledTool;
}

/**
 * Every tool in a tree, with its dotted key.
 */
export const flattenTools = (tools: Tools, prefix = ''): FlattenedTool[] => {
    const collected: FlattenedTool[] = [];
    for (const [name, node] of Object.entries(tools)) {
        const toolKey = prefix ? `${prefix}.${name}` : name;
        if (isCompiledTool(node)) {
            collected.push({ toolKey, tool: node });
        } else if (node && typeof node === 'object') {
            collected.push(...flattenTools(node as Tools, toolKey));
        }
    }
    return collected;
};

/**
 * The tool at a dotted key, or `undefined`.
 */
export const toolAt = (tools: Tools, toolKey: string): CompiledTool | undefined => {
    let current: Tools | CompiledTool | undefined = tools;
    for (const segment of toolKey.split('.')) {
        if (!current || typeof current !== 'object' || isCompiledTool(current)) return undefined;
        current = (current as Tools)[segment];
    }
    return isCompiledTool(current) ? current : undefined;
};
