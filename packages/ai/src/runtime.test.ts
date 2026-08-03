import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { createTool } from './tool.js';
import { agentStream } from './agent-stream.js';
import { runAgent, ToolOutputError } from './runtime.js';

const LookupOrderTool = createTool({
    name: 'lookup_order',
    description: 'Look up an order by id.',
    input: z.object({
        orderId: z.string(),
    }),
    output: z.object({
        status: z.string(),
    }),
});

const usage = {
    inputTokens: {
        total: 11,
        noCache: 11,
        cacheRead: 0,
        cacheWrite: 0,
    },
    outputTokens: {
        total: 22,
        text: 22,
        reasoning: 0,
    },
};

const textStep = (text: string): LanguageModelV4StreamPart[] => [
    {
        type: 'stream-start',
        warnings: [],
    },
    {
        type: 'text-start',
        id: 'text_1',
    },
    {
        type: 'text-delta',
        id: 'text_1',
        delta: text,
    },
    {
        type: 'text-end',
        id: 'text_1',
    },
    {
        type: 'finish',
        finishReason: {
            unified: 'stop',
        },
        usage,
    },
];

const toolCallStep = (input: string): LanguageModelV4StreamPart[] => [
    {
        type: 'stream-start',
        warnings: [],
    },
    {
        type: 'tool-call',
        toolCallId: 'call_1',
        toolName: 'lookup_order',
        input,
    },
    {
        type: 'finish',
        finishReason: {
            unified: 'tool-calls',
        },
        usage,
    },
];

const mockModel = (...steps: LanguageModelV4StreamPart[][]) =>
    new MockLanguageModelV4({
        doStream: steps.map((chunks) => ({
            stream: simulateReadableStream({
                chunks,
                chunkDelayInMs: 0,
                initialDelayInMs: 0,
            }),
        })),
    });

const collect = async <Event>(stream: (emit: never) => AsyncIterable<Event> | Promise<void> | void): Promise<Event[]> => {
    const produced = stream(undefined as never);
    const events: Event[] = [];
    for await (const event of produced as AsyncIterable<Event>) events.push(event);
    return events;
};

describe('runAgent', () => {
    it('emits start before any model output, then text deltas and done', async () => {
        const response = agentStream({
            title: 'PlainEvent',
            tools: [],
        });

        const events = await collect(
            runAgent({
                response,
                model: mockModel(textStep('hello')),
                messages: [{ role: 'user', content: 'hi' }],
                tools: {},
            })
        );

        expect(events).toEqual([
            { type: 'start' },
            { type: 'delta', text: 'hello' },
            {
                type: 'done',
                // The provider reports a structured reason; the SDK unifies it to a string.
                finishReason: 'stop',
                inputTokens: 11,
                outputTokens: 22,
            },
        ]);
    });

    it('runs a declared tool and reports the call and its result', async () => {
        const response = agentStream({
            title: 'FullEvent',
            tools: [LookupOrderTool],
        });
        const lookup = vi.fn(() => ({
            status: 'shipped',
        }));

        const events = await collect(
            runAgent({
                response,
                model: mockModel(toolCallStep('{"orderId":"ord_1"}'), textStep('It shipped.')),
                messages: [{ role: 'user', content: 'where is ord_1' }],
                tools: {
                    lookup_order: lookup,
                },
            })
        );

        expect(lookup).toHaveBeenCalledOnce();
        expect(events).toEqual([
            { type: 'start' },
            {
                type: 'tool_call',
                id: 'call_1',
                name: 'lookup_order',
                input: {
                    orderId: 'ord_1',
                },
            },
            {
                type: 'tool_result',
                id: 'call_1',
                name: 'lookup_order',
                output: {
                    status: 'shipped',
                },
            },
            { type: 'delta', text: 'It shipped.' },
            {
                type: 'done',
                finishReason: 'stop',
                // Usage on the finish part is the total across every step of the loop,
                // so a two-step run reports both.
                inputTokens: 22,
                outputTokens: 44,
            },
        ]);
    });

    it('passes the handler signal to the tool so it stops with the request', async () => {
        const response = agentStream({
            title: 'SignalEvent',
            tools: [LookupOrderTool],
        });
        const controller = new AbortController();
        let seenSignal: AbortSignal | undefined;

        await collect(
            runAgent({
                response,
                model: mockModel(toolCallStep('{"orderId":"ord_1"}'), textStep('done')),
                messages: [{ role: 'user', content: 'where is ord_1' }],
                signal: controller.signal,
                tools: {
                    lookup_order: (_input, context) => {
                        seenSignal = context.signal;
                        return {
                            status: 'shipped',
                        };
                    },
                },
            })
        );

        expect(seenSignal).toBeInstanceOf(AbortSignal);
        expect(seenSignal?.aborted).toBe(false);
        controller.abort();
        expect(seenSignal?.aborted).toBe(true);
    });

    describe('exposure', () => {
        it("sends the events without payloads under 'name-only'", async () => {
            const response = agentStream({
                title: 'NameOnlyEvent',
                tools: [
                    createTool({
                        ...LookupOrderTool,
                        title: 'QuietLookup',
                        expose: 'name-only',
                    }),
                ],
            });

            const events = await collect(
                runAgent({
                    response,
                    model: mockModel(toolCallStep('{"orderId":"ord_1"}'), textStep('ok')),
                    messages: [{ role: 'user', content: 'where is ord_1' }],
                    tools: {
                        lookup_order: () => ({
                            status: 'shipped',
                        }),
                    },
                })
            );

            expect(events).toContainEqual({
                type: 'tool_call',
                id: 'call_1',
                name: 'lookup_order',
            });
            expect(events).toContainEqual({
                type: 'tool_result',
                id: 'call_1',
                name: 'lookup_order',
            });
        });

        it("emits no tool events under 'none' while still running the tool", async () => {
            const response = agentStream({
                title: 'SilentEvent',
                tools: [
                    createTool({
                        ...LookupOrderTool,
                        title: 'SilentLookup',
                        expose: 'none',
                    }),
                ],
            });
            const lookup = vi.fn(() => ({
                status: 'shipped',
            }));

            const events = await collect(
                runAgent({
                    response,
                    model: mockModel(toolCallStep('{"orderId":"ord_1"}'), textStep('ok')),
                    messages: [{ role: 'user', content: 'where is ord_1' }],
                    tools: {
                        lookup_order: lookup,
                    },
                })
            );

            expect(lookup).toHaveBeenCalledOnce();
            expect(events.some((event) => String((event as { type: string }).type).startsWith('tool_'))).toBe(false);
        });
    });

    describe('failures', () => {
        it('reports a thrown tool as a tool_error and keeps streaming', async () => {
            const response = agentStream({
                title: 'ToolFailEvent',
                tools: [LookupOrderTool],
            });

            const events = await collect(
                runAgent({
                    response,
                    model: mockModel(toolCallStep('{"orderId":"ord_1"}'), textStep('I could not check.')),
                    messages: [{ role: 'user', content: 'where is ord_1' }],
                    tools: {
                        lookup_order: () => {
                            throw new Error('order service timed out');
                        },
                    },
                })
            );

            expect(events).toContainEqual({
                type: 'tool_error',
                id: 'call_1',
                name: 'lookup_order',
                message: 'order service timed out',
            });
            expect(events).toContainEqual({ type: 'delta', text: 'I could not check.' });
        });

        // A model that guesses wrong arguments is recoverable: it hears about the failure
        // and can try again, so the stream must survive it.
        it('reports invalid model arguments as a tool_error without calling the tool', async () => {
            const response = agentStream({
                title: 'BadArgsEvent',
                tools: [LookupOrderTool],
            });
            const lookup = vi.fn(() => ({
                status: 'shipped',
            }));

            const events = await collect(
                runAgent({
                    response,
                    model: mockModel(toolCallStep('{"orderId":42}'), textStep('Let me retry.')),
                    messages: [{ role: 'user', content: 'where is ord_1' }],
                    tools: {
                        lookup_order: lookup,
                    },
                })
            );

            expect(lookup).not.toHaveBeenCalled();
            expect(events.some((event) => (event as { type: string }).type === 'tool_error')).toBe(true);
            expect(events).toContainEqual({ type: 'delta', text: 'Let me retry.' });
        });

        // The event union promises the declared output shape, so breaking it is an author
        // bug rather than something to hand back to the model.
        it('fails the stream when a tool returns a value its output schema rejects', async () => {
            const response = agentStream({
                title: 'BadOutputEvent',
                tools: [LookupOrderTool],
            });

            await expect(
                collect(
                    runAgent({
                        response,
                        model: mockModel(toolCallStep('{"orderId":"ord_1"}'), textStep('ok')),
                        messages: [{ role: 'user', content: 'where is ord_1' }],
                        tools: {
                            lookup_order: () => ({ status: 12 }) as unknown as { status: string },
                        },
                    })
                )
            ).rejects.toThrow(ToolOutputError);
        });

        it('throws when a declared tool has no implementation', () => {
            const response = agentStream({
                title: 'MissingImplEvent',
                tools: [LookupOrderTool],
            });

            expect(() =>
                collect(
                    runAgent({
                        response,
                        model: mockModel(textStep('hi')),
                        messages: [{ role: 'user', content: 'hi' }],
                        tools: {} as never,
                    })
                )
            ).rejects.toThrow(/No implementation was supplied for the declared tool 'lookup_order'/);
        });
    });
});
