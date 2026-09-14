import { z } from 'zod';
import type { RequiredPermissions, ResponseDefinition, RouteDefinition, SecurityRequirement, StreamResponseDefinition } from './types.js';
import { ProblemDetailsSchema } from './schemas.js';
import type { HandlerReturn } from './handler-pipeline.js';
import type { ContextFromAccessControlValue, RequestContextValues } from './handler-pipeline.js';
import type { ExtractPathParams, HasPathParams } from './path-params.js';
import { routeToolAnnotations, routeToolDescription, routeToolInput, routeToolOutput } from './tool-projection.js';

/**
 * MCP's tool annotations, verbatim. A route derives these from its method's
 * RFC 9110 semantics; a tool has no method, so it declares them.
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
 * `Tool`.
 */
export interface ToolDefinition {
    /**
     * A human-readable name for display. MCP's `title`.
     */
    title?: string;
    /**
     * What the tool does, in the words the model reads when it decides whether
     * to call it.
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
    /**
     * The statuses the tool may refuse with, beyond the `422`, `500` and `503`
     * every tool answers. Each carries RFC 9457 Problem Details, so there is a
     * set to declare and no bodies.
     *
     * `throwError` takes these and nothing else, and a model reads them as a
     * closed set on the tool's `status`.
     *
     * @example
     * failures: [404, 409],
     */
    failures?: readonly number[];
}

/**
 * What a tool answers with: `200` carrying its `output`, or `204` when it
 * reports nothing, plus `422`, `500`, `503` and whatever it declared under
 * `failures`, each as Problem Details.
 */
export type ToolResponses<Definition extends ToolDefinition> = (Definition extends {
    output: z.ZodType;
}
    ? {
          200: Definition['output'];
      }
    : {
          204: z.ZodVoid;
      }) & {
    422: typeof ProblemDetailsSchema;
    500: typeof ProblemDetailsSchema;
    503: typeof ProblemDetailsSchema;
} & ToolFailureResponses<Definition>;

/**
 * The statuses a tool declared under `failures`, each as Problem Details.
 */
type ToolFailureResponses<Definition extends ToolDefinition> = Definition extends {
    failures: readonly (infer Status extends number)[];
}
    ? {
          [S in Status]: typeof ProblemDetailsSchema;
      }
    : {};

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
 * `body` so nothing collides.
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
 * Every JSON body a route answers a success with, as one union, so the envelope
 * carries them all without a result type per status.
 */
type RouteSuccessBody<R extends RouteDefinition> = {
    [Status in keyof R['responses']]: IsSuccessStatus<Status> extends true ? ResponseBodyValue<R['responses'][Status]> : never;
}[keyof R['responses']];

/**
 * What a route answers with as a tool: the status it chose, the success body it
 * produced, and `detail` when the status says it failed.
 */
export type RouteToolOutputValue<R extends RouteDefinition> = [RouteSuccessBody<R>] extends [never]
    ? {
          status: number;
          detail?: string;
      }
    : {
          status: number;
          body?: RouteSuccessBody<R>;
          detail?: string;
      };

/**
 * The tool a route compiles into. Every field is derived from the route.
 */
export interface RouteToolDefinition<R extends RouteDefinition> {
    title?: string;
    description: string;
    input: z.ZodType<RouteToolInputValue<R>, RouteToolInputValue<R>>;
    output: z.ZodType<RouteToolOutputValue<R>, RouteToolOutputValue<R>>;
    annotations?: ToolAnnotations;
}

const FROM_ROUTE: unique symbol = Symbol('ts-kizuna.tool.toolFromRoutes');

/**
 * A route named inside a tool tree with `toolFromRoutes`. It carries the route
 * itself, so everything the tool needs is derived from it.
 */
export interface RouteToolMarker<R extends RouteDefinition = RouteDefinition> {
    readonly [FROM_ROUTE]: true;
    readonly route: R;
    readonly overrides: RouteToolOverrides;
}

/**
 * What a route-derived tool may say differently from its route. Its
 * authorization is never one of them.
 */
export interface RouteToolOverrides {
    /**
     * A human-readable name for display. Defaults to the route's `summary`.
     */
    title?: string;
    /**
     * What the tool does, in the words the model reads. Defaults to the route's
     * `summary` and `description`, followed by its method and path.
     */
    description?: string;
    /**
     * How the tool behaves. Defaults to what RFC 9110 says about the route's
     * method.
     */
    annotations?: ToolAnnotations;
}

/**
 * A route that streams has no single value to answer with, and one reading a
 * form body has nowhere to put JSON arguments. Naming either is a compile error.
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
 * description, annotations and the identity it requires all come from the route.
 *
 * A group takes a second argument saying what differs: `false` leaves a route
 * out, and an object gives the model different words.
 *
 * @example
 * export const tools = k.tools(({ toolFromRoutes }) => ({
 *     find: toolFromRoutes(routes.users.getUser),
 *     users: toolFromRoutes(routes.users, {
 *         exportUsers: false,
 *         archiveUser: {
 *             description: 'Archive a user. They keep their data and lose access.',
 *         },
 *     }),
 * }));
 */
export function toolFromRoutes<const R extends RouteDefinition>(
    route: R & ToolableRoute<R>,
    overrides?: RouteToolOverrides
): RouteToolMarker<R>;
export function toolFromRoutes<const Group extends object, const Entries extends RouteToolEntries<Group> = {}>(
    // A route takes the overload above, keeping its compile error.
    group: Group extends RouteDefinition ? never : Group,
    entries?: Entries
): RouteToolGroup<Group, Entries>;
export function toolFromRoutes(given: object, second: unknown = {}): unknown {
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
 * the way the group keys it. The rest are not there.
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
            tools[name] = toolFromRoutes(node as never, (entry ?? {}) as RouteToolOverrides);
            continue;
        }
        tools[name] = groupFromRoutes(node, (entry ?? {}) as Record<string, unknown>);
    }
    return tools;
};

/**
 * What `k.tools` hands a builder function.
 */
export interface ToolBuilderHelpers {
    toolFromRoutes: typeof toolFromRoutes;
}

/**
 * The tools themselves, or a function handed the helpers that build them.
 */
export type AuthoredToolsArg<T extends AuthoredTools> = T | ((helpers: ToolBuilderHelpers) => T);

const toolBuilderHelpers: ToolBuilderHelpers = {
    toolFromRoutes,
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
     * What the tool's access control entry resolved to, in the shape a route
     * carries.
     */
    security?: readonly SecurityRequirement[];
    /**
     * The roles the tool accepts, set from the access control map's `roles`.
     */
    roles?: readonly string[];
    /**
     * The permissions the tool requires, set from the access control map's
     * `requires`.
     */
    requires?: RequiredPermissions;
    /**
     * The argument schema, or `undefined` when the tool takes none.
     */
    input: z.ZodType | undefined;
    /**
     * The envelope the tool answers with, which is what a model is shown.
     */
    output: z.ZodType | undefined;
    /**
     * What the tool may answer, by status. A handler's return is validated
     * against the one it chose.
     */
    responses: Record<number, ResponseDefinition>;
    /**
     * The route this tool runs, when it was named with `toolFromRoutes`. Its
     * handler answers the call, and its own gate governs who may make one.
     */
    route?: RouteDefinition;
    /**
     * The dotted key of {@link CompiledTool.route} in the contract's route
     * tree, filled in by `k.contract` once it can see both trees.
     */
    routeKey?: string;
    /**
     * The tags the route inherits from its group.
     */
    routeTags?: readonly string[];
}

/**
 * A route compiled into a tool. It carries the route it runs, which is how
 * everything downstream tells it apart from a declared tool.
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
 * A contract's tools. Nestable, like routes: `tools.weather.getForecast`.
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
 * What a tool handler receives: its own input, `throwError`, and the identity it
 * requires. Anything more it imports, as a route handler would.
 */
export type ToolAuthArg<Value, Identities> =
    ContextFromAccessControlValue<Value, Identities> extends infer Context
        ? [keyof Context] extends [never]
            ? {}
            : {
                  auth: Context;
              }
        : never;

export type ToolHandlerArgs<
    Definition extends ToolDefinition,
    AuthValue_ = false,
    Identities = Record<string, never>,
    RequestContext = Record<string, never>,
> = {
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
     * Throws a typed response, in the same `{ status, body }` shape a handler
     * returns. Never returns.
     */
    throwError: (response: ToolHandlerReturn<Definition>) => never;
} & ToolAuthArg<AuthValue_, Identities> &
    RequestContextValues<RequestContext>;

/**
 * What a tool handler returns: its `output`, or nothing when it declares none.
 */
export type ToolHandlerReturn<Definition extends ToolDefinition> = HandlerReturn<{
    responses: ToolResponses<Definition>;
}>;

/**
 * What a tool answers with, as a caller reads it: the status, its `output` on a
 * success, and `detail` on a failure.
 */
export type ToolOutputValue<Definition extends ToolDefinition> = Definition extends {
    output: z.ZodType;
}
    ? {
          status: number;
          body?: z.output<Definition['output']>;
          detail?: string;
      }
    : {
          status: number;
          detail?: string;
      };

/**
 * A tool reporting nothing may return nothing at all.
 */
export type ToolVoidReturn<Definition extends ToolDefinition> = Definition extends {
    output: z.ZodType;
}
    ? never
    : void;

export type ToolHandler<
    Tool extends CompiledTool,
    Identities = Record<string, never>,
    AuthValue_ = false,
    RequestContext = Record<string, never>,
> = (
    args: ToolHandlerArgs<Tool['definition'], AuthValue_, Identities, RequestContext>
) =>
    | Promise<ToolHandlerReturn<Tool['definition']> | ToolVoidReturn<Tool['definition']>>
    | ToolHandlerReturn<Tool['definition']>
    | ToolVoidReturn<Tool['definition']>;

/**
 * The handlers `server.tools` accepts: one per declared tool, keyed by name.
 */
export type ToolHandlers<
    Tools_ extends Tools,
    Identities = Record<string, never>,
    ToolAuth = {},
    RequestContext = Record<string, never>,
> = {
    [Name in keyof Tools_ as NeedsToolHandler<Tools_[Name]> extends true ? Name : never]: Tools_[Name] extends CompiledTool
        ? ToolHandler<Tools_[Name], Identities, Name extends keyof ToolAuth ? ToolAuth[Name] : false, RequestContext>
        : Tools_[Name] extends Tools
          ? ToolHandlers<Tools_[Name], Identities, Name extends keyof ToolAuth ? ToolAuth[Name] : {}, RequestContext>
          : never;
};

/**
 * Every field a tool may declare. A node carrying only these, with a
 * `description`, is a tool; anything else is a group of them.
 */
const TOOL_FIELDS = ['title', 'description', 'input', 'output', 'annotations', 'failures'] as const;

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
        case 'failures':
            return Array.isArray(value) && value.every((status) => typeof status === 'number');
        default:
            return false;
    }
};

/**
 * Whether a node in an authored tree is a tool rather than a group of them. A
 * tool is the node that describes itself.
 */
export const isToolDefinition = (value: unknown): value is ToolDefinition => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (typeof (value as { description?: unknown }).description !== 'string') return false;
    return Object.entries(value).every(([name, field]) => isToolField(name, field));
};

/**
 * A route named with `toolFromRoutes`, compiled into the shape a declared tool
 * takes.
 *
 * The route object is kept rather than copied, because `k.contract` writes its
 * `security`, `roles` and `requires` from the access control map after this
 * runs.
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
        responses: route.responses,
        route,
    } as unknown as CompiledTool;
};

/**
 * What a tool answers with, in the shape a route carries.
 */
export const buildToolResponses = (definition: ToolDefinition): Record<number, ResponseDefinition> => ({
    ...(definition.output ? { 200: definition.output } : { 204: z.void() }),
    422: ProblemDetailsSchema,
    500: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
    ...Object.fromEntries((definition.failures ?? []).map((status) => [status, ProblemDetailsSchema])),
});

const assertValidTool = (toolKey: string, definition: ToolDefinition): void => {
    if (definition.description.trim() === '') {
        throw new Error(
            `Tool "${toolKey}" has an empty \`description\`. It is the only thing a model reads when it decides whether to call the tool.`
        );
    }
    for (const status of definition.failures ?? []) {
        if (status >= 400 && status <= 599) continue;
        throw new Error(
            `Tool "${toolKey}" lists ${status} under \`failures\`, which is not a 4xx or 5xx. A tool succeeds through \`output\` alone.`
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
                const responses = buildToolResponses(node);
                tools[name] = {
                    definition: node,
                    identity: undefined,
                    input: node.input,
                    output: routeToolOutput({ responses }),
                    responses,
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
 * A route named in a tool tree but absent from the contract's routes throws,
 * since nothing could ever run it.
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
                `Tool "${toolKey}" names a route with \`toolFromRoutes\`, but that route is not on this contract. ` +
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
