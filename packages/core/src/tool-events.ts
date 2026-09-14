import { z } from 'zod';
import { flattenTools, type CompiledTool, type ToolOutputValue, type Tools } from './tools.js';
import type { RouteDefinition, StreamDefinition, StreamResponseDefinition } from './types.js';
import { isStreamResponse, isZodSchema } from './generator-utils.js';

/**
 * Every tool in a tree as its dotted key, e.g. `'weather.getForecast'`.
 */
export type ToolKeys<Tools_ extends Tools, Prefix extends string = ''> = {
    [Name in keyof Tools_ & string]: Tools_[Name] extends CompiledTool
        ? `${Prefix}${Name}`
        : Tools_[Name] extends Tools
          ? ToolKeys<Tools_[Name], `${Prefix}${Name}.`>
          : never;
}[keyof Tools_ & string];

/**
 * The tool one dotted key names.
 */
export type ToolAt<Tools_ extends Tools, Key extends string> = Key extends `${infer Head}.${infer Rest}`
    ? Tools_[Head] extends Tools
        ? ToolAt<Tools_[Head], Rest>
        : never
    : Tools_[Key] extends CompiledTool
      ? Tools_[Key]
      : never;

type SchemaSide<Schema extends z.ZodType, Io extends 'input' | 'output'> = Io extends 'input' ? z.input<Schema> : z.output<Schema>;

/**
 * Collapse an intersection into one object, so a call reads as the record it
 * is rather than as the pieces it was built from.
 */
type Flatten<Shape> = {
    [Key in keyof Shape]: Shape[Key];
} & {};

/**
 * The `input` field of a call, absent for a tool that takes no arguments.
 */
type InputField<Tool extends CompiledTool, Io extends 'input' | 'output'> = Tool['definition'] extends {
    input: z.ZodType;
}
    ? {
          input: SchemaSide<Tool['definition']['input'], Io>;
      }
    : {};

/**
 * The `output` field of a result. Every tool answers the envelope, so a result
 * always carries one.
 */
type OutputField<Tool extends CompiledTool, _Io extends 'input' | 'output'> = {
    output: ToolOutputValue<Tool['definition']>;
};

/**
 * One tool call, discriminated on `name` so `input` narrows to the tool's own
 * argument type.
 */
export type ToolCall<Tools_ extends Tools, Io extends 'input' | 'output' = 'output'> = {
    [Key in ToolKeys<Tools_>]: Flatten<
        {
            id: string;
            name: Key;
        } & InputField<ToolAt<Tools_, Key>, Io>
    >;
}[ToolKeys<Tools_>];

/**
 * One tool result, discriminated on `name` so `output` narrows to the tool's
 * own result type.
 */
export type ToolResult<Tools_ extends Tools, Io extends 'input' | 'output' = 'output'> = {
    [Key in ToolKeys<Tools_>]: Flatten<
        {
            id: string;
            name: Key;
        } & OutputField<ToolAt<Tools_, Key>, Io>
    >;
}[ToolKeys<Tools_>];

/**
 * A tool that failed. The payload is the same whichever tool it was, so this
 * carries the name as a plain enum rather than a discriminated union.
 */
export interface ToolError<Tools_ extends Tools> {
    id: string;
    name: ToolKeys<Tools_>;
    message: string;
}

/**
 * The events {@link toolEvents} adds to a stream.
 */
export interface ToolEvents<Tools_ extends Tools> {
    tool_call: z.ZodType<ToolCall<Tools_, 'output'>, ToolCall<Tools_, 'input'>>;
    tool_result: z.ZodType<ToolResult<Tools_, 'output'>, ToolResult<Tools_, 'input'>>;
    tool_error: z.ZodType<ToolError<Tools_>>;
}

/**
 * Server-sent events for a tool set, to spread into a route's `stream`. Each
 * one is discriminated on the tool's dotted key, so a client's `for await`
 * narrows the payload to the tool that produced it.
 *
 * @example
 * ```ts
 * stream: {
 *     delta: z.object({
 *         text: z.string(),
 *     }),
 * },
 * tools,
 * ```
 */
export const toolEvents = <const Tools_ extends Tools>(tools: Tools_): ToolEvents<Tools_> => {
    const entries = flattenTools(tools);
    if (entries.length === 0) {
        throw new Error('`toolEvents` was given a tool set with no tools in it. Declare at least one tool, or drop the spread.');
    }

    const names = entries.map(({ toolKey }) => toolKey);
    const identifier = {
        id: z.string(),
    };

    const callArms = entries.map(({ toolKey, tool }) =>
        z.object({
            ...identifier,
            name: z.literal(toolKey),
            ...(tool.input ? { input: tool.input } : {}),
        })
    );

    const resultArms = entries.map(({ toolKey, tool }) =>
        z.object({
            ...identifier,
            name: z.literal(toolKey),
            ...(tool.output ? { output: tool.output } : {}),
        })
    );

    const oneOf = (arms: z.ZodObject[]): z.ZodType =>
        arms.length === 1 ? arms[0]! : z.discriminatedUnion('name', arms as [z.ZodObject, z.ZodObject, ...z.ZodObject[]]);

    return {
        tool_call: oneOf(callArms),
        tool_result: oneOf(resultArms),
        tool_error: z.object({
            ...identifier,
            name: z.enum(names as [string, ...string[]]),
            message: z.string(),
        }),
    } as unknown as ToolEvents<Tools_>;
};

/**
 * The events a stream carries once its `tools` have been folded in. A response
 * declaring none is its `stream` untouched.
 */
export type StreamWithTools<Def extends StreamResponseDefinition> = Def extends {
    tools: Tools;
}
    ? Def['stream'] & ToolEvents<Def['tools']>
    : Def['stream'];

/**
 * Fold a response's `tools` into its `stream`, so everything downstream reads
 * one record of named events. Called by `k.routes` before a route is validated.
 */
export const expandStreamTools = (route: RouteDefinition, routeKey: string): void => {
    for (const [status, response] of Object.entries(route.responses)) {
        if (!isStreamResponse(response)) continue;
        const { tools } = response;
        if (tools === undefined) continue;

        const where = `Route "${routeKey}" declares tools on status ${status}`;
        if (isZodSchema(response.stream)) {
            throw new Error(`${where} beside a single stream schema. Tool events are named, so name the other events too.`);
        }

        const events = toolEvents(tools);
        const named = response.stream as Record<string, z.ZodType>;
        for (const name of Object.keys(events)) {
            if (name in named) {
                throw new Error(`${where}, but its stream already names an event "${name}". Rename that event.`);
            }
        }

        const mutable = response as {
            stream: StreamDefinition;
            tools?: Tools;
        };
        mutable.stream = {
            ...named,
            ...(events as unknown as Record<string, z.ZodType>),
        };
        delete mutable.tools;
    }
};
