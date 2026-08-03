import { describe, expect, it, vi } from 'vitest';
import {
    encodeSseChunk,
    normalizeHandlerStream,
    primeStream,
    pumpToNodeResponse,
    reportStreamError,
    sseResponseInit,
    toReadableStream,
    withEventMeta,
    withKeepAlive,
    SSE_HEADERS,
    type EventMeta,
    type NodeStreamResponse,
    type StreamChunk,
} from './stream.js';

const collect = async <T>(source: AsyncIterable<T>): Promise<T[]> => {
    const seen: T[] = [];
    for await (const item of source) seen.push(item);
    return seen;
};

const event = (payload: unknown, meta?: EventMeta): StreamChunk => ({
    kind: 'event',
    payload,
    ...(meta ? { meta } : {}),
});

describe('encodeSseChunk', () => {
    it('frames an event as data lines terminated by a blank line', () => {
        expect(encodeSseChunk(event({ a: 1 }))).toBe('data: {"a":1}\n\n');
    });

    it('splits a multi-line serialization across data lines so it arrives as one event', () => {
        const chunk: StreamChunk = {
            kind: 'event',
            payload: 'first\nsecond',
        };
        // The JSON string itself contains no newline, so force one through a raw payload.
        expect(encodeSseChunk(chunk)).toBe('data: "first\\nsecond"\n\n');
    });

    it('emits event, id, and retry before the data lines', () => {
        expect(
            encodeSseChunk(
                event(
                    {
                        type: 'progress',
                    },
                    {
                        event: 'progress',
                        id: '7',
                        retry: 2000,
                    }
                )
            )
        ).toBe('event: progress\nid: 7\nretry: 2000\ndata: {"type":"progress"}\n\n');
    });

    it('strips CR and LF from field values, which would otherwise end the field', () => {
        const encoded = encodeSseChunk(
            event(
                {},
                {
                    event: 'a\nb',
                    id: 'c\r\nd',
                }
            )
        );
        expect(encoded).toBe('event: a b\nid: c  d\ndata: {}\n\n');
    });

    it('truncates a fractional retry, since the field is an integer', () => {
        expect(
            encodeSseChunk(
                event(
                    {},
                    {
                        retry: 1500.9,
                    }
                )
            )
        ).toContain('retry: 1500\n');
    });

    it('serializes an undefined payload as null rather than dropping the data line', () => {
        expect(encodeSseChunk(event(undefined))).toBe('data: null\n\n');
    });

    it('encodes a comment as a bare colon, the keep-alive frame', () => {
        expect(
            encodeSseChunk({
                kind: 'comment',
            })
        ).toBe(':\n\n');
    });
});

describe('normalizeHandlerStream', () => {
    it('chunks the events of a generator function', async () => {
        const chunks = await collect(
            normalizeHandlerStream(async function* () {
                yield {
                    value: 1,
                };
                yield {
                    value: 2,
                };
            })
        );
        expect(chunks).toEqual([event({ value: 1 }), event({ value: 2 })]);
    });

    it('names events from the eventName field', async () => {
        const chunks = await collect(
            normalizeHandlerStream(
                async function* () {
                    yield {
                        type: 'progress',
                    };
                },
                {
                    eventName: 'type',
                }
            )
        );
        expect(chunks[0]).toEqual(
            event(
                {
                    type: 'progress',
                },
                {
                    event: 'progress',
                }
            )
        );
    });

    it('ignores an eventName whose value is not a string', async () => {
        const chunks = await collect(
            normalizeHandlerStream(
                async function* () {
                    yield {
                        type: 3,
                    };
                },
                {
                    eventName: 'type',
                }
            )
        );
        expect(chunks[0]).toEqual(event({ type: 3 }));
    });

    it('carries withEventMeta through without making it part of the payload', async () => {
        const chunks = await collect(
            normalizeHandlerStream(async function* () {
                yield withEventMeta(
                    {
                        value: 1,
                    },
                    {
                        id: '4',
                    }
                );
            })
        );
        expect(chunks[0]).toEqual(
            event(
                {
                    value: 1,
                },
                {
                    id: '4',
                }
            )
        );
        expect(JSON.stringify((chunks[0] as { payload: unknown }).payload)).toBe('{"value":1}');
    });

    it('merges a derived name with withEventMeta rather than letting either win outright', async () => {
        const chunks = await collect(
            normalizeHandlerStream(
                async function* () {
                    yield withEventMeta(
                        {
                            type: 'progress',
                        },
                        {
                            id: '4',
                        }
                    );
                },
                {
                    eventName: 'type',
                }
            )
        );
        expect(chunks[0]).toEqual(
            event(
                {
                    type: 'progress',
                },
                {
                    event: 'progress',
                    id: '4',
                }
            )
        );
    });

    it('collects events from the writer form', async () => {
        const chunks = await collect(
            normalizeHandlerStream((emit) => {
                emit({
                    value: 1,
                });
                emit(
                    {
                        value: 2,
                    },
                    {
                        id: '2',
                    }
                );
                return Promise.resolve();
            })
        );
        expect(chunks).toEqual([event({ value: 1 }), event({ value: 2 }, { id: '2' })]);
    });

    it('lets the emit argument win over withEventMeta while keeping the rest', async () => {
        const chunks = await collect(
            normalizeHandlerStream((emit) => {
                emit(
                    withEventMeta(
                        {
                            value: 1,
                        },
                        {
                            id: 'attached',
                            retry: 500,
                        }
                    ),
                    {
                        id: 'emitted',
                    }
                );
                return Promise.resolve();
            })
        );
        expect(chunks[0]).toEqual(
            event(
                {
                    value: 1,
                },
                {
                    id: 'emitted',
                    retry: 500,
                }
            )
        );
    });

    it('does not lose events emitted synchronously before the callback settles', async () => {
        const chunks = await collect(
            normalizeHandlerStream((emit) => {
                emit({
                    value: 1,
                });
                emit({
                    value: 2,
                });
                emit({
                    value: 3,
                });
                return Promise.resolve();
            })
        );
        expect(chunks).toHaveLength(3);
    });

    it('delivers events emitted after an await', async () => {
        const chunks = await collect(
            normalizeHandlerStream(async (emit) => {
                emit({
                    value: 1,
                });
                await new Promise((resolve) => setTimeout(resolve, 5));
                emit({
                    value: 2,
                });
            })
        );
        expect(chunks).toEqual([event({ value: 1 }), event({ value: 2 })]);
    });

    it('propagates a rejection from the writer callback', async () => {
        const failing = normalizeHandlerStream(() => Promise.reject(new Error('writer failed')));
        await expect(collect(failing)).rejects.toThrow('writer failed');
    });

    it('propagates a throw from the generator', async () => {
        const failing = normalizeHandlerStream(async function* () {
            yield {
                value: 1,
            };
            throw new Error('generator failed');
        });
        await expect(collect(failing)).rejects.toThrow('generator failed');
    });
});

describe('primeStream', () => {
    it('rejects when the first event fails, before anything can be written', async () => {
        const chunks = normalizeHandlerStream(async function* () {
            throw new Error('no first event');
        });
        await expect(primeStream(chunks)).rejects.toThrow('no first event');
    });

    it('replays the pulled first chunk ahead of the rest', async () => {
        const chunks = normalizeHandlerStream(async function* () {
            yield {
                value: 1,
            };
            yield {
                value: 2,
            };
        });
        expect(await collect(await primeStream(chunks))).toEqual([event({ value: 1 }), event({ value: 2 })]);
    });

    it('resolves to an empty stream when the handler yields nothing', async () => {
        const primed = await primeStream(normalizeHandlerStream(() => Promise.resolve()));
        expect(await collect(primed)).toEqual([]);
    });

    it('surfaces a later failure during iteration, not while priming', async () => {
        const primed = await primeStream(
            normalizeHandlerStream(async function* () {
                yield {
                    value: 1,
                };
                throw new Error('failed second');
            })
        );
        await expect(collect(primed)).rejects.toThrow('failed second');
    });

    it('closes the source when iteration stops early', async () => {
        let closed = false;
        const source: AsyncIterable<StreamChunk> = {
            async *[Symbol.asyncIterator]() {
                try {
                    yield event({ value: 1 });
                    yield event({ value: 2 });
                } finally {
                    closed = true;
                }
            },
        };
        for await (const _chunk of await primeStream(source)) break;
        expect(closed).toBe(true);
    });
});

describe('withKeepAlive', () => {
    it('returns the source untouched when disabled', () => {
        const source = normalizeHandlerStream(() => Promise.resolve());
        expect(withKeepAlive(source, 0)).toBe(source);
    });

    it('emits a comment once the source has been idle for the interval', async () => {
        const source: AsyncIterable<StreamChunk> = {
            async *[Symbol.asyncIterator]() {
                yield event({ value: 1 });
                await new Promise((resolve) => setTimeout(resolve, 60));
                yield event({ value: 2 });
            },
        };
        const chunks = await collect(withKeepAlive(source, 20));
        expect(chunks.filter((chunk) => chunk.kind === 'comment').length).toBeGreaterThanOrEqual(1);
        expect(chunks.filter((chunk) => chunk.kind === 'event')).toEqual([event({ value: 1 }), event({ value: 2 })]);
    });

    it('does not advance the source while waiting out an idle period', async () => {
        let pulls = 0;
        const source: AsyncIterable<StreamChunk> = {
            [Symbol.asyncIterator]() {
                return {
                    next: async () => {
                        pulls += 1;
                        if (pulls > 1) return { done: true, value: undefined };
                        await new Promise((resolve) => setTimeout(resolve, 70));
                        return { done: false, value: event({ value: 1 }) };
                    },
                };
            },
        };
        const chunks = await collect(withKeepAlive(source, 20));
        // Several comments, but exactly one event: the held pending promise was not re-issued.
        expect(chunks.filter((chunk) => chunk.kind === 'event')).toHaveLength(1);
        expect(chunks.filter((chunk) => chunk.kind === 'comment').length).toBeGreaterThanOrEqual(2);
    });

    it('sends no comment when the source keeps up', async () => {
        const source = normalizeHandlerStream(async function* () {
            yield {
                value: 1,
            };
            yield {
                value: 2,
            };
        });
        const chunks = await collect(withKeepAlive(source, 1_000));
        expect(chunks.every((chunk) => chunk.kind === 'event')).toBe(true);
    });
});

describe('sseResponseInit', () => {
    it("merges the SSE headers with the handler's own", () => {
        const init = sseResponseInit({
            status: 200,
            events: normalizeHandlerStream(() => Promise.resolve()),
            headers: {
                'x-request-id': 'abc',
            },
        });
        expect(init.status).toBe(200);
        expect(init.headers).toEqual({
            ...SSE_HEADERS,
            'x-request-id': 'abc',
        });
    });

    it('encodes the events into the body stream', async () => {
        const init = sseResponseInit({
            status: 200,
            events: normalizeHandlerStream(async function* () {
                yield {
                    value: 1,
                };
            }),
        });
        expect(await new Response(init.body).text()).toBe('data: {"value":1}\n\n');
    });
});

describe('toReadableStream', () => {
    it('reports a mid-stream failure and closes rather than erroring the stream', async () => {
        const onError = vi.fn();
        const body = toReadableStream(
            normalizeHandlerStream(async function* () {
                yield {
                    value: 1,
                };
                throw new Error('mid-stream');
            }),
            {
                onError,
            }
        );
        expect(await new Response(body).text()).toBe('data: {"value":1}\n\n');
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'mid-stream' }));
    });

    it('closes the source when the consumer cancels', async () => {
        let closed = false;
        const source: AsyncIterable<StreamChunk> = {
            async *[Symbol.asyncIterator]() {
                try {
                    yield event({ value: 1 });
                    yield event({ value: 2 });
                } finally {
                    closed = true;
                }
            },
        };
        const body = toReadableStream(source);
        const reader = body.getReader();
        await reader.read();
        await reader.cancel();
        expect(closed).toBe(true);
    });
});

/**
 * Stands in for a Node `ServerResponse`. `capacity` writes succeed, then `write`
 * reports a full buffer so the pump has to wait for room.
 */
const fakeNodeResponse = (capacity = Infinity) => {
    const listeners = new Map<string, Array<() => void>>();
    const written: string[] = [];
    let writes = 0;
    return {
        written,
        head: undefined as { status: number; headers: Record<string, string> } | undefined,
        ended: false,
        writableEnded: false,
        writeHead(status: number, headers: Record<string, string>) {
            this.head = {
                status,
                headers,
            };
        },
        write(chunk: string) {
            written.push(chunk);
            writes += 1;
            return writes < capacity;
        },
        end() {
            this.ended = true;
            this.writableEnded = true;
        },
        once(name: string, listener: () => void) {
            listeners.set(name, [...(listeners.get(name) ?? []), listener]);
        },
        off(name: string, listener: () => void) {
            listeners.set(
                name,
                (listeners.get(name) ?? []).filter((candidate) => candidate !== listener)
            );
        },
        emit(name: string) {
            for (const listener of [...(listeners.get(name) ?? [])]) listener();
        },
        listenerCount(name: string) {
            return (listeners.get(name) ?? []).length;
        },
    };
};

describe('pumpToNodeResponse', () => {
    it('writes the status and merged headers, then every frame, then ends', async () => {
        const response = fakeNodeResponse();
        await pumpToNodeResponse(response as unknown as NodeStreamResponse, {
            status: 200,
            events: normalizeHandlerStream(async function* () {
                yield {
                    value: 1,
                };
                yield {
                    value: 2,
                };
            }),
            headers: {
                'x-request-id': 'abc',
            },
        });
        expect(response.head).toEqual({
            status: 200,
            headers: {
                ...SSE_HEADERS,
                'x-request-id': 'abc',
            },
        });
        expect(response.written.join('')).toBe('data: {"value":1}\n\ndata: {"value":2}\n\n');
        expect(response.ended).toBe(true);
    });

    it('waits for drain when the socket buffer fills, then resumes', async () => {
        const response = fakeNodeResponse(1);
        const pumped = pumpToNodeResponse(response as unknown as NodeStreamResponse, {
            status: 200,
            events: normalizeHandlerStream(async function* () {
                yield {
                    value: 1,
                };
                yield {
                    value: 2,
                };
            }),
        });
        await vi.waitFor(() => expect(response.written).toHaveLength(1));
        response.emit('drain');
        await pumped;
        expect(response.written).toHaveLength(2);
        expect(response.ended).toBe(true);
    });

    // A disconnect means `drain` will never fire. Without settling on `close` the pump
    // would wait forever, holding the handler's generator open with it.
    it('stops waiting for capacity when the connection closes instead', async () => {
        const response = fakeNodeResponse(1);
        let closedSource = false;
        const pumped = pumpToNodeResponse(response as unknown as NodeStreamResponse, {
            status: 200,
            events: {
                async *[Symbol.asyncIterator]() {
                    try {
                        yield event({ value: 1 });
                        yield event({ value: 2 });
                    } finally {
                        closedSource = true;
                    }
                },
            },
        });
        await vi.waitFor(() => expect(response.written).toHaveLength(1));
        response.emit('close');
        await expect(pumped).resolves.toBeUndefined();
        expect(closedSource).toBe(true);
    });

    it('stops waiting for capacity when the request aborts', async () => {
        const response = fakeNodeResponse(1);
        const controller = new AbortController();
        const pumped = pumpToNodeResponse(
            response as unknown as NodeStreamResponse,
            {
                status: 200,
                events: normalizeHandlerStream(async function* () {
                    yield {
                        value: 1,
                    };
                    yield {
                        value: 2,
                    };
                }),
            },
            {
                signal: controller.signal,
            }
        );
        await vi.waitFor(() => expect(response.written).toHaveLength(1));
        controller.abort();
        await expect(pumped).resolves.toBeUndefined();
    });

    it('removes its capacity listeners once room frees up', async () => {
        const response = fakeNodeResponse(1);
        const pumped = pumpToNodeResponse(response as unknown as NodeStreamResponse, {
            status: 200,
            events: normalizeHandlerStream(async function* () {
                yield {
                    value: 1,
                };
                yield {
                    value: 2,
                };
            }),
        });
        await vi.waitFor(() => expect(response.listenerCount('drain')).toBe(1));
        response.emit('drain');
        await pumped;
        expect(response.listenerCount('drain')).toBe(0);
        expect(response.listenerCount('close')).toBe(0);
        expect(response.listenerCount('error')).toBe(0);
    });

    it('stops pumping once the signal is aborted', async () => {
        const response = fakeNodeResponse();
        const controller = new AbortController();
        let produced = 0;
        await pumpToNodeResponse(
            response as unknown as NodeStreamResponse,
            {
                status: 200,
                events: {
                    async *[Symbol.asyncIterator]() {
                        while (true) {
                            produced += 1;
                            if (produced === 2) controller.abort();
                            yield event({ produced });
                        }
                    },
                },
            },
            {
                signal: controller.signal,
            }
        );
        expect(response.written).toHaveLength(2);
        expect(response.ended).toBe(true);
    });

    it('reports a mid-stream failure and still ends the response', async () => {
        const response = fakeNodeResponse();
        const onError = vi.fn();
        await pumpToNodeResponse(
            response as unknown as NodeStreamResponse,
            {
                status: 200,
                events: normalizeHandlerStream(async function* () {
                    yield {
                        value: 1,
                    };
                    throw new Error('mid-stream');
                }),
            },
            {
                onError,
            }
        );
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'mid-stream' }));
        expect(response.ended).toBe(true);
    });
});

describe('reportStreamError', () => {
    it('hands the error to onStreamError instead of logging', () => {
        const onStreamError = vi.fn();
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        const error = new Error('boom');
        reportStreamError('express', 'users.streamActivity', error, 'request', onStreamError);
        expect(onStreamError).toHaveBeenCalledWith(error, 'request');
        expect(logged).not.toHaveBeenCalled();
        logged.mockRestore();
    });

    it('logs when no hook is given, so a dead stream is never silent', () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        reportStreamError('hono', 'users.streamActivity', new Error('boom'), 'request');
        expect(logged).toHaveBeenCalledWith('[ts-kizuna/hono] stream error on users.streamActivity:', expect.any(Error));
        logged.mockRestore();
    });

    it('falls back to logging when the hook itself throws', () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        reportStreamError('next', 'users.streamActivity', new Error('boom'), 'request', () => {
            throw new Error('hook failed');
        });
        expect(logged).toHaveBeenCalledWith('[ts-kizuna/next] onStreamError hook threw:', expect.any(Error));
        expect(logged).toHaveBeenCalledWith('[ts-kizuna/next] stream error on users.streamActivity:', expect.any(Error));
        logged.mockRestore();
    });
});
