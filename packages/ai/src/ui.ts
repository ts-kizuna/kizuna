import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';

/**
 * The subset of an agent event this adapter reads. Events a contract adds of its
 * own are ignored rather than guessed at.
 */
type KnownAgentEvent =
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
          type: 'tool_call';
          id: string;
          name: string;
          input?: unknown;
      }
    | {
          type: 'tool_result';
          id: string;
          name: string;
          output?: unknown;
      }
    | {
          type: 'tool_error';
          id: string;
          name: string;
          message: string;
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

const TEXT_ID = 'text';
const REASONING_ID = 'reasoning';

/**
 * Converts a kizuna agent event stream into the chunks the AI SDK's UI helpers
 * consume.
 *
 * Text and reasoning arrive as deltas without an explicit start, so their
 * `*-start` chunk is emitted on first sight and the matching `*-end` when the
 * stream finishes.
 */
export const toUIMessageChunks = async function* <Event>(events: AsyncIterable<Event>): AsyncGenerator<UIMessageChunk> {
    let textOpen = false;
    let reasoningOpen = false;
    let stepOpen = false;

    const closeParts = function* (): Generator<UIMessageChunk> {
        if (reasoningOpen) {
            yield {
                type: 'reasoning-end',
                id: REASONING_ID,
            };
            reasoningOpen = false;
        }
        if (textOpen) {
            yield {
                type: 'text-end',
                id: TEXT_ID,
            };
            textOpen = false;
        }
        if (stepOpen) {
            yield {
                type: 'finish-step',
            };
            stepOpen = false;
        }
    };

    for await (const event of events) {
        const known = event as KnownAgentEvent;
        switch (known.type) {
            case 'start': {
                yield {
                    type: 'start',
                };
                yield {
                    type: 'start-step',
                };
                stepOpen = true;
                break;
            }
            case 'reasoning': {
                if (!reasoningOpen) {
                    yield {
                        type: 'reasoning-start',
                        id: REASONING_ID,
                    };
                    reasoningOpen = true;
                }
                yield {
                    type: 'reasoning-delta',
                    id: REASONING_ID,
                    delta: known.text,
                };
                break;
            }
            case 'delta': {
                if (!textOpen) {
                    yield {
                        type: 'text-start',
                        id: TEXT_ID,
                    };
                    textOpen = true;
                }
                yield {
                    type: 'text-delta',
                    id: TEXT_ID,
                    delta: known.text,
                };
                break;
            }
            case 'tool_call': {
                // A tool exposed as name-only sends no arguments, and the UI helpers
                // accept that: the call still renders, with nothing to show for input.
                yield {
                    type: 'tool-input-available',
                    toolCallId: known.id,
                    toolName: known.name,
                    input: known.input,
                };
                break;
            }
            case 'tool_result': {
                yield {
                    type: 'tool-output-available',
                    toolCallId: known.id,
                    output: known.output,
                };
                break;
            }
            case 'tool_error': {
                yield {
                    type: 'tool-output-error',
                    toolCallId: known.id,
                    errorText: known.message,
                };
                break;
            }
            case 'done': {
                yield* closeParts();
                yield {
                    type: 'finish',
                };
                break;
            }
            case 'aborted': {
                yield* closeParts();
                yield {
                    type: 'error',
                    errorText: known.reason,
                };
                break;
            }
            default:
                break;
        }
    }

    yield* closeParts();
};

/**
 * A message in the shape a kizuna chat route usually takes.
 */
export interface ChatTurn {
    role: 'user' | 'assistant';
    content: string;
}

/**
 * Flattens the AI SDK's `UIMessage` parts into plain text turns, dropping the
 * parts a text chat route has no field for.
 */
export const toChatTurns = (messages: readonly UIMessage[]): ChatTurn[] =>
    messages
        .filter((message): message is UIMessage & { role: 'user' | 'assistant' } => message.role === 'user' || message.role === 'assistant')
        .map((message) => ({
            role: message.role,
            content: message.parts
                .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
                .map((part) => part.text)
                .join(''),
        }))
        .filter((turn) => turn.content.length > 0);

export interface AgentTransportOptions<Event> {
    /**
     * Calls the route. Return the typed stream from the generated client, or
     * `undefined` when the request failed, in which case the reason surfaces as an
     * error chunk.
     */
    call: (options: { messages: ChatTurn[]; abortSignal: AbortSignal | undefined }) => Promise<
        | {
              stream: AsyncIterable<Event>;
          }
        | {
              error: string;
          }
    >;
}

/**
 * Adapts a kizuna agent route to the AI SDK's chat transport, so `useChat` drives
 * a contract-typed endpoint with no bespoke client code.
 *
 * The route keeps kizuna's own event union on the wire, which is what the typed
 * fetch client, the OpenAPI document and the Swift and Kotlin clients read. This
 * converts that union to UI chunks in the browser instead of changing the wire
 * format for everyone.
 *
 * @example
 * ```ts
 * const transport = createAgentTransport({
 *     call: async ({ messages, abortSignal }) => {
 *         const result = await apiClient.chat.sendChatMessage({
 *             body: { messages },
 *             fetchOptions: { signal: abortSignal },
 *         });
 *         return result.status === 200 ? result : { error: result.body.detail };
 *     },
 * });
 *
 * const { messages, sendMessage } = useChat({ transport });
 * ```
 */
export const createAgentTransport = <Event, Message extends UIMessage = UIMessage>(
    options: AgentTransportOptions<Event>
): ChatTransport<Message> => ({
    async sendMessages({ messages, abortSignal }) {
        const outcome = await options.call({
            messages: toChatTurns(messages),
            abortSignal,
        });

        if ('error' in outcome) {
            return new ReadableStream<UIMessageChunk>({
                start(controller) {
                    controller.enqueue({
                        type: 'error',
                        errorText: outcome.error,
                    });
                    controller.close();
                },
            });
        }

        const chunks = toUIMessageChunks(outcome.stream)[Symbol.asyncIterator]();
        return new ReadableStream<UIMessageChunk>({
            async pull(controller) {
                const next = await chunks.next();
                if (next.done) {
                    controller.close();
                    return;
                }
                controller.enqueue(next.value);
            },
            async cancel() {
                await chunks.return?.(undefined);
            },
        });
    },
    // Resuming needs a server-side record of the stream, which a kizuna route does
    // not keep. `Last-Event-ID` resumption is the contract-level equivalent.
    async reconnectToStream() {
        return null;
    },
});
