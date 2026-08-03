/**
 * One dispatched Server-Sent Event, with the `data:` payload already JSON-parsed.
 */
export interface ParsedEvent {
    payload: unknown;
    event?: string;
    id?: string;
    retry?: number;
}

interface EventBuffer {
    data: string[];
    event?: string;
    id?: string;
    retry?: number;
}

const emptyBuffer = (): EventBuffer => ({
    data: [],
});

/**
 * Splits a decoded chunk into complete lines, returning the trailing partial line
 * so the next chunk can finish it. Mid-stream, a `\r` at the very end is held back
 * because the `\n` of a `\r\n` pair may not have arrived yet; once `final` is set
 * there is nothing more coming, so it terminates its line.
 */
const splitLines = (buffer: string, final: boolean): { lines: string[]; rest: string } => {
    const lines: string[] = [];
    let start = 0;
    let index = 0;
    while (index < buffer.length) {
        const character = buffer[index];
        if (character === '\n') {
            lines.push(buffer.slice(start, index));
            index += 1;
            start = index;
            continue;
        }
        if (character === '\r') {
            if (index === buffer.length - 1 && !final) break;
            lines.push(buffer.slice(start, index));
            index += buffer[index + 1] === '\n' ? 2 : 1;
            start = index;
            continue;
        }
        index += 1;
    }
    return {
        lines,
        rest: buffer.slice(start),
    };
};

const dispatch = (buffer: EventBuffer): ParsedEvent | undefined => {
    if (buffer.data.length === 0) return undefined;
    const raw = buffer.data.join('\n');
    let payload: unknown;
    try {
        payload = JSON.parse(raw);
    } catch {
        payload = raw;
    }
    return {
        payload,
        ...(buffer.event !== undefined ? { event: buffer.event } : {}),
        ...(buffer.id !== undefined ? { id: buffer.id } : {}),
        ...(buffer.retry !== undefined ? { retry: buffer.retry } : {}),
    };
};

const applyField = (buffer: EventBuffer, line: string): void => {
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    switch (field) {
        case 'data':
            buffer.data.push(value);
            break;
        case 'event':
            buffer.event = value;
            break;
        case 'id':
            // An id containing NULL is ignored (9.2.6).
            if (!value.includes('\0')) buffer.id = value;
            break;
        case 'retry':
            if (/^\d+$/.test(value)) buffer.retry = Number(value);
            break;
        default:
            break;
    }
};

/**
 * Parses an SSE byte stream into events. Breaking out of the iteration cancels the
 * underlying reader.
 *
 * @see https://html.spec.whatwg.org/multipage/server-sent-events.html (WHATWG HTML 9.2.5, "Parsing an event stream")
 */
export const parseSseStream = (body: ReadableStream<Uint8Array>): AsyncIterable<ParsedEvent> => ({
    async *[Symbol.asyncIterator]() {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let pending = '';
        let buffer = emptyBuffer();
        let atStart = true;

        const consume = function* (lines: string[]): Generator<ParsedEvent> {
            for (const line of lines) {
                if (line === '') {
                    const event = dispatch(buffer);
                    buffer = emptyBuffer();
                    if (event) yield event;
                    continue;
                }
                if (line.startsWith(':')) continue;
                applyField(buffer, line);
            }
        };

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                pending += decoder.decode(value, {
                    stream: true,
                });
                if (atStart && pending.startsWith('﻿')) {
                    pending = pending.slice(1);
                }
                atStart = false;
                const { lines, rest } = splitLines(pending, false);
                pending = rest;
                yield* consume(lines);
            }
            pending += decoder.decode();
            const { lines } = splitLines(pending, true);
            yield* consume(lines);
            // Whatever is left is an unterminated block, which 9.2.5 discards. That is also what
            // keeps a truncated stream from yielding a half-formed event.
        } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
        }
    },
});
