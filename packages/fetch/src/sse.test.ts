import { describe, expect, it } from 'vitest';
import { parseSseStream, type ParsedEvent } from './sse.js';

const streamOf = (...chunks: string[]): ReadableStream<Uint8Array> => {
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
            controller.close();
        },
    });
};

const collect = async (...chunks: string[]): Promise<ParsedEvent[]> => {
    const events: ParsedEvent[] = [];
    for await (const event of parseSseStream(streamOf(...chunks))) events.push(event);
    return events;
};

describe('parseSseStream', () => {
    it('parses a single event', async () => {
        const events = await collect('data: {"a":1}\n\n');
        expect(events).toEqual([
            {
                payload: {
                    a: 1,
                },
            },
        ]);
    });

    it('reads event, id, and retry fields', async () => {
        const events = await collect('event: progress\nid: 7\nretry: 2000\ndata: {"a":1}\n\n');
        expect(events).toEqual([
            {
                payload: {
                    a: 1,
                },
                event: 'progress',
                id: '7',
                retry: 2000,
            },
        ]);
    });

    it('joins multiple data lines with newlines before parsing', async () => {
        const events = await collect('data: {"a":\ndata: 1}\n\n');
        expect(events[0]?.payload).toEqual({
            a: 1,
        });
    });

    it('reassembles an event split across arbitrary chunk boundaries', async () => {
        const frame = 'event: progress\nid: 3\ndata: {"value":"hello"}\n\n';
        for (let split = 1; split < frame.length; split += 1) {
            const events = await collect(frame.slice(0, split), frame.slice(split));
            expect(events, `split at ${split}`).toEqual([
                {
                    payload: {
                        value: 'hello',
                    },
                    event: 'progress',
                    id: '3',
                },
            ]);
        }
    });

    it('handles a CRLF pair split across chunks', async () => {
        const events = await collect('data: {"a":1}\r', '\n\r\n');
        expect(events).toEqual([
            {
                payload: {
                    a: 1,
                },
            },
        ]);
    });

    it('accepts CR, LF, and CRLF line endings', async () => {
        expect(await collect('data: 1\r\r')).toHaveLength(1);
        expect(await collect('data: 1\n\n')).toHaveLength(1);
        expect(await collect('data: 1\r\n\r\n')).toHaveLength(1);
    });

    it('ignores comments and unknown fields', async () => {
        const events = await collect(':keep-alive\n\ndata: {"a":1}\nunknown: x\n\n');
        expect(events).toEqual([
            {
                payload: {
                    a: 1,
                },
            },
        ]);
    });

    it('strips only one leading space from a field value', async () => {
        const events = await collect('data:  spaced\n\n');
        expect(events[0]?.payload).toBe(' spaced');
    });

    it('falls back to the raw string when data is not JSON', async () => {
        const events = await collect('data: not json\n\n');
        expect(events[0]?.payload).toBe('not json');
    });

    it('ignores an id containing NULL', async () => {
        const events = await collect('id: a\0b\ndata: 1\n\n');
        expect(events[0]?.id).toBeUndefined();
    });

    it('ignores a non-numeric retry', async () => {
        const events = await collect('retry: soon\ndata: 1\n\n');
        expect(events[0]?.retry).toBeUndefined();
    });

    it('strips a leading byte order mark', async () => {
        const events = await collect('﻿data: {"a":1}\n\n');
        expect(events[0]?.payload).toEqual({
            a: 1,
        });
    });

    it('does not dispatch a block with no data field', async () => {
        expect(await collect('event: ping\n\n')).toEqual([]);
    });

    it('discards an unterminated final block', async () => {
        expect(await collect('data: {"a":1}\n')).toEqual([]);
    });

    it('yields several events from one chunk', async () => {
        const events = await collect('data: 1\n\ndata: 2\n\ndata: 3\n\n');
        expect(events.map((event) => event.payload)).toEqual([1, 2, 3]);
    });
});
