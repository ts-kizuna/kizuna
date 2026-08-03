import { z } from 'zod';
import { createModel, readDiscriminatedUnion, readDiscriminatorStringLiteral, type StreamResponseDefinition } from '@ts-kizuna/core';
import type { ToolDeclaration } from './types.js';

/**
 * Tool events are named after this field, so `agentStream` fixes `eventName`
 * to it rather than taking one.
 */
const DISCRIMINATOR = 'type';

/**
 * The events any tool-calling stream emits, whatever tools it declares.
 *
 * `start` is sent before the model produces anything: the adapter pulls the first
 * event before writing headers, so without it the status stays uncommitted until
 * the first token arrives.
 */
export type AgentStreamEvent =
    | {
          type: 'start';
      }
    | {
          type: 'reasoning';
          text: string;
      }
    | {
          type: 'delta';
          text: string;
      }
    | {
          type: 'done';
          finishReason: string;
          inputTokens: number;
          outputTokens: number;
      }
    | {
          type: 'aborted';
          reason: string;
      };

type ToolCallEvent<Tool extends ToolDeclaration> = Tool['expose'] extends 'name-only'
    ? {
          type: 'tool_call';
          id: string;
          name: Tool['name'];
      }
    : {
          type: 'tool_call';
          id: string;
          name: Tool['name'];
          input: z.output<Tool['input']>;
      };

type ToolResultEvent<Tool extends ToolDeclaration> = Tool['expose'] extends 'name-only'
    ? {
          type: 'tool_result';
          id: string;
          name: Tool['name'];
      }
    : {
          type: 'tool_result';
          id: string;
          name: Tool['name'];
          output: z.output<Tool['output']>;
      };

type ToolErrorEvent<Tool extends ToolDeclaration> = {
    type: 'tool_error';
    id: string;
    name: Tool['name'];
    message: string;
};

/**
 * The events derived from a set of tool declarations. A tool exposed as `'none'`
 * contributes nothing.
 */
export type ToolStreamEvent<Tools extends readonly ToolDeclaration[]> = {
    [Index in keyof Tools]: Tools[Index] extends ToolDeclaration
        ? Tools[Index]['expose'] extends 'none'
            ? never
            : ToolCallEvent<Tools[Index]> | ToolResultEvent<Tools[Index]> | ToolErrorEvent<Tools[Index]>
        : never;
}[number];

/**
 * Everything a tool-calling stream can yield: the standard agent events, the
 * events derived from its tools, and the author's own event schema.
 */
export type AgentStreamEventOf<Tools extends readonly ToolDeclaration[], Event extends z.ZodType | undefined> =
    | AgentStreamEvent
    | ToolStreamEvent<Tools>
    | (Event extends z.ZodType ? z.output<Event> : never);

export interface AgentStreamOptions<Tools extends readonly ToolDeclaration[], Event extends z.ZodType | undefined> {
    /**
     * Name of the merged event union in the generated OpenAPI spec and native
     * clients. Unique across the contract, like any other model title.
     */
    title: string;
    description?: string;
    /**
     * The tools the model may call, each built with `createTool`. Omit it for a
     * stream with no tools, though a route that never calls one wants core's
     * plain `{ stream: 'sse', event }` form instead.
     */
    tools?: Tools;
    /**
     * Extra application-specific events, merged into the union. Variants must
     * discriminate on `type`, since that is what names an event on the wire.
     */
    event?: Event;
    headers?: z.ZodType;
}

/**
 * A streaming response whose event union is known statically, so a handler's
 * yields and a client's iteration are both typed against it.
 */
export interface AgentStreamResponseDefinition<Event, Tools extends readonly ToolDeclaration[]> extends Omit<
    StreamResponseDefinition,
    'event' | 'tools'
> {
    event: z.ZodType<Event, Event>;
    tools: Tools;
}

const agentVariants = (title: string): z.ZodType[] => [
    createModel({
        title: `${title}Start`,
        schema: z.object({
            type: z.literal('start'),
        }),
    }),
    createModel({
        title: `${title}Reasoning`,
        schema: z.object({
            type: z.literal('reasoning'),
            text: z.string(),
        }),
    }),
    createModel({
        title: `${title}Delta`,
        schema: z.object({
            type: z.literal('delta'),
            text: z.string(),
        }),
    }),
    createModel({
        title: `${title}Done`,
        schema: z.object({
            type: z.literal('done'),
            finishReason: z.string(),
            inputTokens: z.int(),
            outputTokens: z.int(),
        }),
    }),
    createModel({
        title: `${title}Aborted`,
        schema: z.object({
            type: z.literal('aborted'),
            reason: z.string(),
        }),
    }),
];

/**
 * Variants are titled from the tool rather than the response, so a tool shared by
 * several routes contributes one set of models to the spec instead of one per
 * route. That also means `expose` belongs to the tool: two routes cannot describe
 * the same tool differently under the same title.
 */
const toolVariants = (tools: readonly ToolDeclaration[]): z.ZodType[] => {
    const variants: z.ZodType[] = [];
    for (const tool of tools) {
        if (tool.expose === 'none') continue;
        variants.push(
            createModel({
                title: `${tool.title}Call`,
                description: tool.description,
                schema: z.object({
                    type: z.literal('tool_call'),
                    id: z.string(),
                    name: z.literal(tool.name),
                    ...(tool.expose === 'full'
                        ? {
                              input: tool.input,
                          }
                        : {}),
                }),
            }),
            createModel({
                title: `${tool.title}Result`,
                schema: z.object({
                    type: z.literal('tool_result'),
                    id: z.string(),
                    name: z.literal(tool.name),
                    ...(tool.expose === 'full'
                        ? {
                              output: tool.output,
                          }
                        : {}),
                }),
            }),
            createModel({
                title: `${tool.title}Error`,
                schema: z.object({
                    type: z.literal('tool_error'),
                    id: z.string(),
                    name: z.literal(tool.name),
                    message: z.string(),
                }),
            })
        );
    }
    return variants;
};

/**
 * Flattens an author's event schema into variants so they sit alongside the
 * derived ones in a single union. A discriminated union contributes its options;
 * anything else contributes itself.
 */
const authorVariants = (event: z.ZodType): z.ZodType[] => {
    const discriminated = readDiscriminatedUnion(event);
    if (discriminated && discriminated.discriminator === DISCRIMINATOR) return discriminated.options as z.ZodType[];
    return [event];
};

const assertDistinctToolNames = (title: string, tools: readonly ToolDeclaration[]): void => {
    const seen = new Set<string>();
    for (const tool of tools) {
        if (seen.has(tool.name)) {
            throw new Error(
                `agentStream('${title}') declares the tool '${tool.name}' twice. A model cannot tell two same-named tools apart.`
            );
        }
        seen.add(tool.name);
    }
};

/**
 * A duplicate `type` would make the union ambiguous, and which variant wins would
 * decide whether an event validates. Fail while the contract is being built
 * instead.
 */
const assertDistinctTypes = (title: string, variants: z.ZodType[]): void => {
    const seen = new Set<string>();
    for (const variant of variants) {
        const literal = readDiscriminatorStringLiteral(variant, DISCRIMINATOR);
        if (literal === undefined) continue;
        if (seen.has(literal)) {
            throw new Error(
                `agentStream('${title}') produced two events with type '${literal}'. The 'event' schema redeclares a reserved event name.`
            );
        }
        seen.add(literal);
    }
};

/**
 * Declare a streaming response the model can call tools from.
 *
 * The returned definition is an ordinary `StreamResponseDefinition` whose `event`
 * is the merged union of the standard agent events, one set of events per declared
 * tool, and any events of your own. Merging happens here rather than at request
 * time, so the adapter, the OpenAPI generator, the native clients and
 * `@ts-kizuna/fetch` all see one plain Zod union.
 *
 * Events are named after their `type` field, which is why variants passed as
 * `event` have to discriminate on it.
 *
 * @example
 * ```ts
 * const ListEventsTool = createTool({
 *     name: 'list_events',
 *     description: 'List events between two dates.',
 *     input: z.object({
 *         from: z.string(),
 *     }),
 *     output: z.array(EventSchema),
 * });
 *
 * streamChat: {
 *     method: 'POST',
 *     path: '/chat',
 *     body: z.object({
 *         messages: z.array(ChatMessageSchema),
 *     }),
 *     responses: {
 *         200: agentStream({
 *             title: 'ChatEvent',
 *             tools: [ListEventsTool],
 *         }),
 *     },
 * }
 * ```
 */
export const agentStream = <const Tools extends readonly ToolDeclaration[] = readonly [], Event extends z.ZodType | undefined = undefined>(
    options: AgentStreamOptions<Tools, Event>
): AgentStreamResponseDefinition<AgentStreamEventOf<Tools, Event>, Tools> => {
    const tools = options.tools ?? ([] as unknown as Tools);
    assertDistinctToolNames(options.title, tools);
    const variants: z.ZodType[] = [
        ...agentVariants(options.title),
        ...toolVariants(tools),
        ...(options.event ? authorVariants(options.event) : []),
    ];
    assertDistinctTypes(options.title, variants);

    const everyVariantIsTagged = variants.every((variant) => readDiscriminatorStringLiteral(variant, DISCRIMINATOR) !== undefined);
    const union = everyVariantIsTagged
        ? z.discriminatedUnion(DISCRIMINATOR, variants as unknown as Parameters<typeof z.discriminatedUnion>[1])
        : z.union(variants as unknown as Parameters<typeof z.union>[0]);

    const event = createModel({
        title: options.title,
        description: options.description,
        schema: union,
    });

    return {
        stream: 'sse',
        // The runtime schema is the union built above. The cast supplies the static
        // type, which Zod cannot infer through a dynamically assembled union.
        event: event as unknown as z.ZodType<AgentStreamEventOf<Tools, Event>, AgentStreamEventOf<Tools, Event>>,
        eventName: DISCRIMINATOR,
        tools,
        ...(options.headers
            ? {
                  headers: options.headers,
              }
            : {}),
    };
};
