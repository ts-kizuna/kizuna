import { stepCountIs, streamText, tool, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';
import type { HandlerStream } from '@ts-kizuna/core';
import type { AgentStreamResponseDefinition } from './agent-stream.js';
import type { ToolContext, ToolImplementations } from './tool.js';
import type { ToolDeclaration, ToolExposure } from './types.js';

/**
 * Steps the model may take before the loop stops. A step is one model turn plus
 * any tools it called, so a task needing three rounds of tool use spends three.
 */
const DEFAULT_MAX_STEPS = 12;

/**
 * A tool returned something its declared `output` schema rejects.
 *
 * Unlike a bad argument from the model, which is recoverable and reported to the
 * model as a tool error, this is a broken promise to the client: the event union
 * says `tool_result` carries that shape. It fails the stream instead.
 */
export class ToolOutputError extends Error {
    constructor(
        readonly toolName: string,
        readonly cause: unknown
    ) {
        super(`Tool '${toolName}' returned a value its output schema rejects.`);
        this.name = 'ToolOutputError';
    }
}

export interface RunAgentOptions<Event, Tools extends readonly ToolDeclaration[]> {
    /**
     * The response built with `agentStream`. It carries the tool declarations and
     * their exposure, and types both the implementations and the events.
     */
    response: AgentStreamResponseDefinition<Event, Tools>;
    /**
     * A model from any AI SDK provider, such as `anthropic('claude-opus-5')`.
     */
    model: LanguageModel;
    system?: string;
    messages: ModelMessage[];
    /**
     * One implementation per declared tool, keyed by tool name.
     */
    tools: ToolImplementations<Tools>;
    /**
     * The handler's `signal`. Passing it stops generation and in-flight tool work
     * when the client disconnects.
     */
    signal?: AbortSignal;
    /**
     * @default 12
     */
    maxSteps?: number;
    /**
     * Provider-specific settings, passed through untouched. This is where
     * anything outside the AI SDK's own surface goes, such as Anthropic's
     * thinking configuration.
     */
    providerOptions?: Parameters<typeof streamText>[0]['providerOptions'];
}

const errorMessage = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return 'The tool failed.';
};

const NEVER_ABORTS: AbortSignal = new AbortController().signal;

const buildToolSet = <Tools extends readonly ToolDeclaration[]>(
    declarations: Tools,
    implementations: ToolImplementations<Tools>,
    signal: AbortSignal | undefined
): ToolSet => {
    const lookup = implementations as Record<string, (input: never, context: ToolContext) => unknown>;
    const toolSet: ToolSet = {};
    for (const declaration of declarations) {
        const run = lookup[declaration.name];
        if (!run) throw new Error(`No implementation was supplied for the declared tool '${declaration.name}'.`);
        toolSet[declaration.name] = tool({
            description: declaration.description,
            inputSchema: declaration.input,
            execute: async (input, { abortSignal }) => {
                const output = await run(input as never, {
                    signal: abortSignal ?? signal ?? NEVER_ABORTS,
                });
                const parsed = declaration.output.safeParse(output);
                if (!parsed.success) throw new ToolOutputError(declaration.name, parsed.error);
                return parsed.data;
            },
        });
    }
    return toolSet;
};

/**
 * Run a model with the tools a route declared, and project what it does onto that
 * route's event union.
 *
 * The AI SDK owns the model loop, the tool-schema conversion per provider, and
 * validation of the arguments the model supplies. This function owns the parts
 * that belong to the contract: emitting `start` before the model produces
 * anything, so the response status is committed rather than waiting on the first
 * token; deciding what rides on the wire per the tool's `expose`; and checking
 * each tool's return against its declared `output`.
 *
 * A model that passes bad arguments is recoverable: the AI SDK reports the failure
 * to the model, which can correct itself, and a `tool_error` event goes out while
 * the stream continues. A tool returning the wrong shape is not, and fails the
 * stream so the adapter's `onStreamError` sees it.
 *
 * @example
 * ```ts
 * import { anthropic } from '@ai-sdk/anthropic';
 *
 * sendChatMessage: async ({ body, signal }) => ({
 *     status: 200,
 *     stream: runAgent({
 *         response: ChatStream,
 *         model: anthropic('claude-opus-5'),
 *         messages: body.messages,
 *         signal,
 *         tools: {
 *             list_events: ({ from }) => db.events.since(from),
 *         },
 *     }),
 * })
 * ```
 */
export const runAgent = <Event, const Tools extends readonly ToolDeclaration[]>(
    options: RunAgentOptions<Event, Tools>
): HandlerStream<Event> =>
    async function* () {
        const declarations = options.response.tools;
        const exposureOf = new Map<string, ToolExposure>(declarations.map((declaration) => [declaration.name, declaration.expose]));
        const result = streamText({
            model: options.model,
            ...(options.system === undefined ? {} : { system: options.system }),
            messages: options.messages,
            tools: buildToolSet(declarations, options.tools, options.signal),
            stopWhen: stepCountIs(options.maxSteps ?? DEFAULT_MAX_STEPS),
            ...(options.signal === undefined ? {} : { abortSignal: options.signal }),
            ...(options.providerOptions === undefined ? {} : { providerOptions: options.providerOptions }),
        });

        // Before the first token, so the status is settled while the model thinks.
        yield { type: 'start' } as Event;

        for await (const part of result.fullStream) {
            switch (part.type) {
                case 'text-delta': {
                    if (part.text.length > 0) yield { type: 'delta', text: part.text } as Event;
                    break;
                }
                case 'reasoning-delta': {
                    if (part.text.length > 0) yield { type: 'reasoning', text: part.text } as Event;
                    break;
                }
                case 'tool-call': {
                    const exposure = exposureOf.get(part.toolName);
                    if (exposure === undefined || exposure === 'none') break;
                    yield (
                        exposure === 'full'
                            ? { type: 'tool_call', id: part.toolCallId, name: part.toolName, input: part.input }
                            : { type: 'tool_call', id: part.toolCallId, name: part.toolName }
                    ) as Event;
                    break;
                }
                case 'tool-result': {
                    const exposure = exposureOf.get(part.toolName);
                    if (exposure === undefined || exposure === 'none') break;
                    yield (
                        exposure === 'full'
                            ? { type: 'tool_result', id: part.toolCallId, name: part.toolName, output: part.output }
                            : { type: 'tool_result', id: part.toolCallId, name: part.toolName }
                    ) as Event;
                    break;
                }
                case 'tool-error': {
                    // A tool that broke its own output contract is an author bug, not
                    // something the model can retry its way out of.
                    if (part.error instanceof ToolOutputError) throw part.error;
                    const exposure = exposureOf.get(part.toolName);
                    if (exposure === undefined || exposure === 'none') break;
                    yield {
                        type: 'tool_error',
                        id: part.toolCallId,
                        name: part.toolName,
                        message: errorMessage(part.error),
                    } as Event;
                    break;
                }
                case 'finish': {
                    yield {
                        type: 'done',
                        finishReason: part.finishReason,
                        inputTokens: part.totalUsage.inputTokens ?? 0,
                        outputTokens: part.totalUsage.outputTokens ?? 0,
                    } as Event;
                    break;
                }
                case 'abort': {
                    yield { type: 'aborted', reason: part.reason ?? 'The stream was aborted.' } as Event;
                    break;
                }
                case 'error': {
                    // Surfaces through the adapter's onStreamError once the status is out.
                    throw part.error;
                }
                default:
                    break;
            }
        }
    };
