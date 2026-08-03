import { describe, expect, it } from 'vitest';
import type { UIMessage, UIMessageChunk } from 'ai';
import { createAgentTransport, toChatTurns, toUIMessageChunks } from './ui.js';

const from = async function* (...events: unknown[]) {
    for (const event of events) yield event;
};

const collect = async (events: AsyncIterable<unknown>): Promise<UIMessageChunk[]> => {
    const chunks: UIMessageChunk[] = [];
    for await (const chunk of toUIMessageChunks(events)) chunks.push(chunk);
    return chunks;
};

const drain = async (stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> => {
    const chunks: UIMessageChunk[] = [];
    const reader = stream.getReader();
    while (true) {
        const next = await reader.read();
        if (next.done) break;
        chunks.push(next.value);
    }
    return chunks;
};

describe('toUIMessageChunks', () => {
    // A step left open would leave the UI waiting, so the end of the stream closes it
    // even when the model never sent a done event.
    it('opens a step on start and closes it when the stream ends', async () => {
        expect(await collect(from({ type: 'start' }))).toEqual([{ type: 'start' }, { type: 'start-step' }, { type: 'finish-step' }]);
    });

    it('opens the text part once and streams deltas into it', async () => {
        const chunks = await collect(from({ type: 'delta', text: 'hel' }, { type: 'delta', text: 'lo' }));

        expect(chunks).toEqual([
            { type: 'text-start', id: 'text' },
            { type: 'text-delta', id: 'text', delta: 'hel' },
            { type: 'text-delta', id: 'text', delta: 'lo' },
            { type: 'text-end', id: 'text' },
        ]);
    });

    it('streams reasoning into its own part', async () => {
        const chunks = await collect(from({ type: 'reasoning', text: 'weighing' }));

        expect(chunks).toEqual([
            { type: 'reasoning-start', id: 'reasoning' },
            { type: 'reasoning-delta', id: 'reasoning', delta: 'weighing' },
            { type: 'reasoning-end', id: 'reasoning' },
        ]);
    });

    it('carries a fully exposed tool call and its result', async () => {
        const chunks = await collect(
            from(
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
                }
            )
        );

        expect(chunks).toEqual([
            {
                type: 'tool-input-available',
                toolCallId: 'call_1',
                toolName: 'lookup_order',
                input: {
                    orderId: 'ord_1',
                },
            },
            {
                type: 'tool-output-available',
                toolCallId: 'call_1',
                output: {
                    status: 'shipped',
                },
            },
        ]);
    });

    it('still renders a name-only tool, with nothing to show for its payloads', async () => {
        const chunks = await collect(
            from({ type: 'tool_call', id: 'call_1', name: 'search_orders' }, { type: 'tool_result', id: 'call_1', name: 'search_orders' })
        );

        expect(chunks).toEqual([
            {
                type: 'tool-input-available',
                toolCallId: 'call_1',
                toolName: 'search_orders',
                input: undefined,
            },
            {
                type: 'tool-output-available',
                toolCallId: 'call_1',
                output: undefined,
            },
        ]);
    });

    it('maps a tool failure onto the output error chunk', async () => {
        const chunks = await collect(from({ type: 'tool_error', id: 'call_1', name: 'lookup_order', message: 'timed out' }));

        expect(chunks).toEqual([
            {
                type: 'tool-output-error',
                toolCallId: 'call_1',
                errorText: 'timed out',
            },
        ]);
    });

    it('closes the open parts and the step before finishing', async () => {
        const chunks = await collect(
            from({ type: 'start' }, { type: 'delta', text: 'hi' }, { type: 'done', finishReason: 'stop', inputTokens: 1, outputTokens: 2 })
        );

        expect(chunks.map((chunk) => chunk.type)).toEqual([
            'start',
            'start-step',
            'text-start',
            'text-delta',
            'text-end',
            'finish-step',
            'finish',
        ]);
    });

    it('reports an abort as an error chunk', async () => {
        const chunks = await collect(from({ type: 'aborted', reason: 'client disconnected' }));

        expect(chunks).toEqual([
            {
                type: 'error',
                errorText: 'client disconnected',
            },
        ]);
    });

    it('ignores events a contract added of its own', async () => {
        expect(await collect(from({ type: 'quota_warning', remaining: 3 }))).toEqual([]);
    });
});

describe('toChatTurns', () => {
    it('flattens text parts and drops turns with nothing to say', () => {
        const messages = [
            {
                id: '1',
                role: 'user',
                parts: [
                    { type: 'text', text: 'where is ' },
                    { type: 'text', text: 'ord_1' },
                ],
            },
            {
                id: '2',
                role: 'assistant',
                parts: [{ type: 'step-start' }],
            },
            {
                id: '3',
                role: 'system',
                parts: [{ type: 'text', text: 'ignored' }],
            },
        ] as unknown as UIMessage[];

        expect(toChatTurns(messages)).toEqual([
            {
                role: 'user',
                content: 'where is ord_1',
            },
        ]);
    });
});

describe('createAgentTransport', () => {
    it('streams the converted chunks from a successful call', async () => {
        const transport = createAgentTransport({
            call: async () => ({
                stream: from({ type: 'delta', text: 'hello' }),
            }),
        });

        const stream = await transport.sendMessages({
            trigger: 'submit-message',
            chatId: 'chat_1',
            messageId: undefined,
            messages: [],
            abortSignal: undefined,
        });

        expect((await drain(stream)).map((chunk) => chunk.type)).toEqual(['text-start', 'text-delta', 'text-end']);
    });

    it('turns a failed call into a single error chunk', async () => {
        const transport = createAgentTransport({
            call: async () => ({
                error: 'Messages must not be empty.',
            }),
        });

        const stream = await transport.sendMessages({
            trigger: 'submit-message',
            chatId: 'chat_1',
            messageId: undefined,
            messages: [],
            abortSignal: undefined,
        });

        expect(await drain(stream)).toEqual([
            {
                type: 'error',
                errorText: 'Messages must not be empty.',
            },
        ]);
    });

    it('passes the flattened turns and the abort signal to the call', async () => {
        const controller = new AbortController();
        let seen: unknown;
        const transport = createAgentTransport({
            call: async (options) => {
                seen = options;
                return {
                    stream: from(),
                };
            },
        });

        await transport.sendMessages({
            trigger: 'submit-message',
            chatId: 'chat_1',
            messageId: undefined,
            messages: [
                {
                    id: '1',
                    role: 'user',
                    parts: [{ type: 'text', text: 'hi' }],
                },
            ] as unknown as UIMessage[],
            abortSignal: controller.signal,
        });

        expect(seen).toEqual({
            messages: [
                {
                    role: 'user',
                    content: 'hi',
                },
            ],
            abortSignal: controller.signal,
        });
    });

    it('does not pretend a dropped stream can be resumed', async () => {
        const transport = createAgentTransport({
            call: async () => ({
                stream: from(),
            }),
        });

        expect(await transport.reconnectToStream({ chatId: 'chat_1' })).toBeNull();
    });
});
