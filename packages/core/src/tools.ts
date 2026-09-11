import { z } from 'zod';
import type { AccessGate, RouteDefinition, SecurityRequirement, StreamResponseDefinition } from './types.js';
import type { AuthValue } from './kizuna.js';
import type { ContextFromAuthValue } from './handler-pipeline.js';
import type { ExtractPathParams, HasPathParams } from './path-params.js';
import { routeToolAnnotations, routeToolDescription, routeToolInput, routeToolOutput } from './tool-projection.js';

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
 * Collapse an intersection into one object, so a derived shape reads as the
 * record it is rather than as the pieces it was built from.
 */
type FlattenShape<Shape> = {
    [Key in keyof Shape]: Shape[Key];
} & {};

/**
 * The `params` a route takes as a tool: its declared `pathParams`, or a string
 * per placeholder in its path.
 */
type RouteToolParams<R extends RouteDefinition> = R extends {
    pathParams: z.ZodType;
}
    ? {
          params: z.output<R['pathParams']>;
      }
    : HasPathParams<R['path']> extends true
      ? {
            params: ExtractPathParams<R['path']>;
        }
      : {};

/**
 * Present when the route declares one, and optional when the schema is happy
 * with nothing, matching what the projection does at runtime.
 */
type RouteToolQuery<R extends RouteDefinition> = R extends {
    query: z.ZodType;
}
    ? {} extends z.input<R['query']>
        ? {
              query?: z.output<R['query']>;
          }
        : {
              query: z.output<R['query']>;
          }
    : {};

type RouteToolBody<R extends RouteDefinition> = R extends {
    body: z.ZodType;
}
    ? undefined extends z.input<R['body']>
        ? {
              body?: z.output<R['body']>;
          }
        : {
              body: z.output<R['body']>;
          }
    : {};

/**
 * The arguments a route takes as a tool, kept under `params`, `query` and
 * `body` so nothing collides and the model can see which values identify a
 * resource.
 */
export type RouteToolInputValue<R extends RouteDefinition> = FlattenShape<RouteToolParams<R> & RouteToolQuery<R> & RouteToolBody<R>>;

type IsSuccessStatus<Status> = `${Status & number}` extends `2${string}` ? true : false;

type ResponseBodyValue<Response> = Response extends StreamResponseDefinition
    ? never
    : Response extends z.ZodType
      ? z.output<Response>
      : Response extends {
              body: z.ZodType;
          }
        ? z.output<Response['body']>
        : never;

/**
 * Every JSON body a route answers a success with. A route with several success
 * statuses yields their union, which is what lets the `{ status, body }`
 * envelope carry them all without a result type per status.
 */
type RouteSuccessBody<R extends RouteDefinition> = {
    [Status in keyof R['responses']]: IsSuccessStatus<Status> extends true ? ResponseBodyValue<R['responses'][Status]> : never;
}[keyof R['responses']];

/**
 * What a route answers with as a tool. `status` is the HTTP status it chose, so
 * a model reads `400` or more as a failure, and `body` carries whichever
 * success body it produced.
 */
export type RouteToolOutputValue<R extends RouteDefinition> = [RouteSuccessBody<R>] extends [never]
    ? {
          status: number;
      }
    : {
          status: number;
          body?: RouteSuccessBody<R>;
      };

/**
 * The tool a route compiles into. Everything is derived, so naming a route in a
 * tool tree costs one line and restates nothing.
 */
export interface RouteToolDefinition<R extends RouteDefinition> {
    title?: string;
    description: string;
    input: z.ZodType<RouteToolInputValue<R>, RouteToolInputValue<R>>;
    output: z.ZodType<RouteToolOutputValue<R>, RouteToolOutputValue<R>>;
    annotations?: ToolAnnotations;
}

const FROM_ROUTE: unique symbol = Symbol('ts-kizuna.tool.fromRoutes');

/**
 * A route named inside a tool tree with `k.tools.fromRoutes`. It carries the
 * route itself, so the tool's schemas, description and annotations are derived
 * from the one place they are already declared.
 */
export interface RouteToolMarker<R extends RouteDefinition = RouteDefinition> {
    readonly [FROM_ROUTE]: true;
    readonly route: R;
    readonly overrides: RouteToolOverrides;
}

/**
 * What a route-derived tool may say differently from its route. Everything else
 * comes from the route, and its authorization always does.
 */
export interface RouteToolOverrides {
    /**
     * A human-readable name for display. Defaults to the route's `summary`.
     */
    title?: string;
    /**
     * What the tool does, in the words the model reads. Defaults to the route's
     * `summary` and `description`, followed by its method and path.
     *
     * Worth writing when the route's own summary was written for a developer
     * reading your docs rather than for a model choosing between tools.
     */
    description?: string;
    /**
     * How the tool behaves. Defaults to what RFC 9110 says about the route's
     * method, which is almost always what you want.
     */
    annotations?: ToolAnnotations;
}

/**
 * A route that streams has no single value to answer with, and one reading a
 * form body has nowhere to put JSON arguments. Either is a compile error where
 * the route is named, rather than a tool that quietly never appears.
 */
export type ToolableRoute<R extends RouteDefinition> =
    true extends StreamingResponse<R>
        ? 'This route streams, so it cannot be a tool.'
        : R extends {
                contentType: 'multipart/form-data' | 'application/x-www-form-urlencoded';
            }
          ? 'This route reads a form body, so it cannot be a tool.'
          : R;

type StreamingResponse<R extends RouteDefinition> = {
    [Status in keyof R['responses']]: R['responses'][Status] extends StreamResponseDefinition ? true : false;
}[keyof R['responses']];

/**
 * Name a route as a tool, or a whole group of them. Arguments, result,
 * description and annotations come from the route, and so does the identity it
 * requires, so a route is never restated to put it in front of a model.
 *
 * A group takes a second argument saying what differs: `false` leaves a route
 * out, and an object gives the model different words.
 *
 * @example
 * export const tools = k.tools(({ fromRoutes }) => ({
 *     find: fromRoutes(routes.users.getUser),
 *     users: fromRoutes(routes.users, {
 *         exportUsers: false,
 *         archiveUser: {
 *             description: 'Archive a user. They keep their data and lose access.',
 *         },
 *     }),
 * }));
 */
export function fromRoutes<const R extends RouteDefinition>(
    route: R & ToolableRoute<R>,
    overrides?: RouteToolOverrides
): RouteToolMarker<R>;
export function fromRoutes<const Group extends object, const Entries extends RouteToolEntries<Group> = {}>(
    // A single route takes the overload above, so the compile error it carries
    // for a streamed or form-body route is not swallowed here.
    group: Group extends RouteDefinition ? never : Group,
    entries?: Entries
): RouteToolGroup<Group, Entries>;
export function fromRoutes(given: object, second: unknown = {}): unknown {
    if (isRouteDefinition(given)) {
        return {
            [FROM_ROUTE]: true,
            route: given,
            overrides: (second ?? {}) as RouteToolOverrides,
        };
    }
    return groupFromRoutes(given, (second ?? {}) as Record<string, unknown>);
}

export const isRouteToolMarker = (value: unknown): value is RouteToolMarker => !!value && typeof value === 'object' && FROM_ROUTE in value;

/**
 * A route group as a tool group: every route in it that can be a tool, keyed
 * the way the group keys it. The ones that cannot, because they stream or read
 * a form body, are simply not there, and so is anything the second argument
 * sets to `false`.
 */
export type RouteToolGroup<Group, Entries> = {
    [Name in keyof Group as Group[Name] extends RouteDefinition
        ? ToolableRoute<Group[Name]> extends RouteDefinition
            ? Name extends keyof Entries
                ? Entries[Name] extends false
                    ? never
                    : Name
                : Name
            : never
        : Name]: Group[Name] extends RouteDefinition
        ? RouteToolMarker<Group[Name]>
        : RouteToolGroup<Group[Name], Name extends keyof Entries ? Entries[Name] : {}>;
};

/**
 * What a group's second argument says about each route in it: `false` to leave
 * it out, or the wording to give the model instead of the route's own.
 */
export type RouteToolEntries<Group> = {
    [Name in keyof Group]?: Group[Name] extends RouteDefinition ? false | RouteToolOverrides : RouteToolEntries<Group[Name]>;
};

const isRouteDefinition = (value: object): value is RouteDefinition => 'method' in value && 'path' in value && 'responses' in value;

/**
 * A route streams, or reads a form body, and so has nothing a tool could carry.
 * Naming one on its own is a compile error; taking a whole group skips it.
 */
const canBeTool = (route: RouteDefinition): boolean => {
    if (route.contentType !== undefined && route.contentType !== 'application/json') return false;
    return !Object.values(route.responses).some((response) => !!response && typeof response === 'object' && 'stream' in response);
};

const groupFromRoutes = (group: object, entries: Record<string, unknown>): Record<string, unknown> => {
    const tools: Record<string, unknown> = {};
    for (const [name, node] of Object.entries(group)) {
        if (!node || typeof node !== 'object') continue;
        const entry = entries[name];
        if (entry === false) continue;
        if (isRouteDefinition(node)) {
            if (!canBeTool(node)) continue;
            tools[name] = fromRoutes(node as never, (entry ?? {}) as RouteToolOverrides);
            continue;
        }
        tools[name] = groupFromRoutes(node, (entry ?? {}) as Record<string, unknown>);
    }
    return tools;
};

/**
 * What `k.tools` hands a builder function. The helper is scoped to the tree it
 * builds, so `k.tools.fromRoutes` need not be written on every line of a tree
 * that is already inside `k.tools`.
 */
export interface ToolBuilderHelpers {
    fromRoutes: typeof fromRoutes;
}

/**
 * The tools themselves, or a function handed the helpers that build them.
 */
export type AuthoredToolsArg<T extends AuthoredTools> = T | ((helpers: ToolBuilderHelpers) => T);

const toolBuilderHelpers: ToolBuilderHelpers = {
    fromRoutes,
};

/**
 * A builder's tools, or the tools as given.
 */
export const resolveAuthoredTools = <T extends AuthoredTools>(given: AuthoredToolsArg<T>): T =>
    typeof given === 'function' ? given(toolBuilderHelpers) : given;

/**
 * A tool after `k.tools` compiles it.
 */
export interface CompiledTool<
    Definition extends ToolDefinition = ToolDefinition,
    IdentityName extends string | undefined = string | undefined,
> {
    definition: Definition;
    /**
     * The identity whose context the handler receives, resolved from the tool's
     * own `auth`. A tool running a route takes the route's instead.
     */
    identity: IdentityName;
    /**
     * What the tool's `auth` resolved to, in the shape a route carries.
     */
    security?: readonly SecurityRequirement[];
    accessGate?: AccessGate;
    /**
     * The argument schema, or `undefined` when the tool takes none.
     */
    input: z.ZodType | undefined;
    /**
     * The result schema, or `undefined` when the tool reports nothing.
     */
    output: z.ZodType | undefined;
    /**
     * The route this tool runs, when it was named with `k.tools.fromRoutes`.
     * Its handler answers the call, and its own `security` and `accessGate`
     * govern who may make one.
     */
    route?: RouteDefinition;
    /**
     * The dotted key of {@link CompiledTool.route} in the contract's route
     * tree, filled in by `k.contract` once it can see both trees.
     */
    routeKey?: string;
    /**
     * The tags the route inherits from its group. Tags sit on the route tree
     * rather than on a route, so they are read in the same pass as the key.
     */
    routeTags?: readonly string[];
}

/**
 * A route compiled into a tool. It carries the route it runs, which is how
 * everything downstream tells it apart from a declared tool: it needs no
 * handler of its own, and its authorization is the route's.
 */
export interface CompiledRouteTool<R extends RouteDefinition = RouteDefinition> extends CompiledTool<RouteToolDefinition<R>, undefined> {
    route: R;
    routeKey: string;
}

/**
 * Whether a node in a compiled tool tree needs a handler written for it. A
 * route-derived tool does not: its route already has one.
 */
export type NeedsToolHandler<Node> = Node extends {
    route: RouteDefinition;
}
    ? false
    : Node extends CompiledTool
      ? true
      : Node extends Tools
        ? true extends {
              [Name in keyof Node]: NeedsToolHandler<Node[Name]>;
          }[keyof Node]
            ? true
            : false
        : false;

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
    [key: string]: ToolDefinition | RouteToolMarker | AuthoredTools;
}

/**
 * The compiled form of an authored tool tree, preserving its shape.
 */
export type CompiledTools<Definitions extends AuthoredTools> = {
    [Name in keyof Definitions]: Definitions[Name] extends RouteToolMarker<infer R>
        ? CompiledRouteTool<R>
        : Definitions[Name] extends ToolDefinition
          ? CompiledTool<Definitions[Name]>
          : Definitions[Name] extends AuthoredTools
            ? CompiledTools<Definitions[Name]>
            : never;
};

/**
 * A tool tree with no tools in it, for a contract that declares none.
 */
export type NoTools = Record<string, never>;

/**
 * The single object a tool handler receives: its own input, `throwError`, and
 * the identity it requires. Anything more it imports, as a route handler would.
 */
export type ToolAuthArg<Value, Identities> =
    ContextFromAuthValue<Value, Identities> extends infer Context
        ? [keyof Context] extends [never]
            ? {}
            : {
                  auth: Context;
              }
        : never;

export type ToolHandlerArgs<Definition extends ToolDefinition, AuthValue_ = false, Identities = Record<string, never>> = {
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
} & ToolAuthArg<AuthValue_, Identities>;

/**
 * What a tool handler returns: its `output`, or nothing when it declares none.
 */
export type ToolHandlerReturn<Definition extends ToolDefinition> = Definition extends {
    output: z.ZodType;
}
    ? z.input<Definition['output']>
    : void;

export type ToolHandler<Tool extends CompiledTool, Identities = Record<string, never>, AuthValue_ = false> = (
    args: ToolHandlerArgs<Tool['definition'], AuthValue_, Identities>
) => Promise<ToolHandlerReturn<Tool['definition']>> | ToolHandlerReturn<Tool['definition']>;

/**
 * The handlers `server.tools` accepts: one per declared tool, keyed by name.
 */
export type ToolHandlers<Tools_ extends Tools, Identities = Record<string, never>, ToolAuth = {}> = {
    [Name in keyof Tools_ as NeedsToolHandler<Tools_[Name]> extends true ? Name : never]: Tools_[Name] extends CompiledTool
        ? ToolHandler<Tools_[Name], Identities, Name extends keyof ToolAuth ? ToolAuth[Name] : false>
        : Tools_[Name] extends Tools
          ? ToolHandlers<Tools_[Name], Identities, Name extends keyof ToolAuth ? ToolAuth[Name] : {}>
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

/**
 * A route named with `k.tools.fromRoutes`, compiled into the same shape a
 * declared tool takes. Everything is derived from the route, so the two are
 * indistinguishable to everything downstream.
 *
 * The route object is kept rather than copied, because `k.contract` writes its
 * `security` and `accessGate` from the auth map after this runs.
 */
const compileRouteTool = (toolKey: string, marker: RouteToolMarker): CompiledTool => {
    const { route, overrides } = marker;
    const input = routeToolInput(route);
    const output = routeToolOutput(route);
    const title = overrides.title ?? route.summary;
    const definition: ToolDefinition = {
        ...(title === undefined ? {} : { title }),
        description: overrides.description ?? routeToolDescription(route),
        ...(input === undefined ? {} : { input }),
        output,
        annotations: overrides.annotations ?? routeToolAnnotations(route),
    };
    assertValidTool(toolKey, definition);

    return {
        definition,
        identity: undefined,
        input,
        output,
        route,
    } as unknown as CompiledTool;
};

/**
 * One entry of a tool auth map, in the shape a route carries, so one path
 * checks both.
 */
export const resolveToolAuth = (
    value: AuthValue | undefined
): {
    identity: string | undefined;
    security?: readonly SecurityRequirement[];
    accessGate?: AccessGate;
} => {
    if (value === undefined || value === false) {
        return {
            identity: undefined,
        };
    }
    if (typeof value === 'string') {
        return {
            identity: value,
            security: [value],
        };
    }

    const requirement: Record<string, readonly string[]> = {};
    const gate: AccessGate = {};
    for (const [scheme, constraint] of Object.entries(value)) {
        if (constraint === true) {
            requirement[scheme] = [];
        } else if (Array.isArray(constraint)) {
            requirement[scheme] = constraint as readonly string[];
        } else {
            requirement[scheme] = [];
            const fields = constraint as Record<string, unknown>;
            if (Object.keys(fields).length > 0) gate[scheme] = fields;
        }
    }

    return {
        identity: Object.keys(requirement)[0],
        security: [requirement as SecurityRequirement],
        ...(Object.keys(gate).length > 0 ? { accessGate: gate } : {}),
    };
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
const RESERVED_ROOT_NAMES = ['call', 'dispatch', 'emit', 'as', 'definitions', 'keyOf'] as const;

/**
 * Compile authored tool definitions into {@link Tools}, preserving nesting.
 * Backs `k.tools`.
 */
export const buildTools = (definitions: AuthoredTools): Tools => {
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
            if (isRouteToolMarker(node)) {
                tools[name] = compileRouteTool(toolKey, node);
                continue;
            }
            if (isToolDefinition(node)) {
                assertValidTool(toolKey, node);
                tools[name] = {
                    definition: node,
                    // Written by `k.contract` from the tool auth map, the one
                    // place that says who may call what.
                    identity: undefined,
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

/**
 * Give every route-derived tool the dotted key of its route, matched by object
 * identity against the contract's own route tree.
 *
 * A route value carries no key of its own, so this is where the two trees are
 * put side by side. A route named in a tool tree but absent from the contract's
 * routes is a mistake worth stopping at startup, since nothing could ever run
 * it.
 */
export const attachRouteKeys = (
    tools: Tools,
    keyByRoute: Map<RouteDefinition, { routeKey: string; routeTags: readonly string[] }>
): void => {
    for (const { toolKey, tool } of flattenTools(tools)) {
        if (tool.route === undefined) continue;
        const found = keyByRoute.get(tool.route);
        if (found === undefined) {
            throw new Error(
                `Tool "${toolKey}" names a route with \`k.tools.fromRoutes\`, but that route is not on this contract. ` +
                    `Pass the route from the same tree you pass to \`k.contract\`.`
            );
        }
        const mutable = tool as {
            routeKey?: string;
            routeTags?: readonly string[];
        };
        mutable.routeKey = found.routeKey;
        mutable.routeTags = found.routeTags;
    }
};

/**
 * Write a tool auth map onto the tools it names. A tool running a route is
 * refused an entry: that route already says who may call it.
 */
export const applyToolAuth = (tools: Tools, map: Record<string, unknown>, path = ''): void => {
    for (const [name, value] of Object.entries(map)) {
        const toolKey = path ? `${path}.${name}` : name;
        const node = tools[name];
        if (node === undefined) {
            throw new Error(`Tool auth map names "${toolKey}", which this contract does not declare.`);
        }
        if (isCompiledTool(node)) {
            if (node.route !== undefined) {
                throw new Error(
                    `Tool "${toolKey}" runs a route, so the route's own entry in the auth map says who may call it. Remove this one.`
                );
            }
            Object.assign(node, resolveToolAuth(value as AuthValue));
            continue;
        }
        applyToolAuth(node as Tools, value as Record<string, unknown>, toolKey);
    }
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
