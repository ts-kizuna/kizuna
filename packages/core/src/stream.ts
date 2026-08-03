/**
 * Per-event metadata for a Server-Sent Events stream.
 *
 * @see https://html.spec.whatwg.org/multipage/server-sent-events.html (WHATWG HTML 9.2.6, "Interpreting an event stream")
 */
export interface EventMeta {
    /**
     * The `id:` field. A client echoes the last one it saw back as the
     * `Last-Event-ID` request header when it reconnects, so handlers can resume.
     */
    id?: string;
    /**
     * The `event:` field, which browser clients listen for with
     * `addEventListener(name)`.
     */
    event?: string;
    /**
     * The `retry:` field, in milliseconds.
     */
    retry?: number;
}

/**
 * One unit written to a stream: an event, or a comment used as a keep-alive.
 */
export type StreamChunk =
    | {
          kind: 'event';
          payload: unknown;
          meta?: EventMeta;
      }
    | {
          kind: 'comment';
      };

/**
 * Emits one event from a handler's writer-form stream. Pass it to the code that
 * produces events so emission need not happen at the `yield` site.
 */
export type StreamEmit<Event> = (event: Event, meta?: EventMeta) => void;

/**
 * What a handler returns under `stream`: an async generator function, whose yields
 * are typed against the response's `event` schema, or a callback that emits through
 * {@link StreamEmit}. Wrap an existing async iterable in a function to pass it:
 * `stream: () => existingIterable`.
 */
export type HandlerStream<Event> = (emit: StreamEmit<Event>) => AsyncIterable<Event> | Promise<void> | void;

const EVENT_META: unique symbol = Symbol('ts-kizuna.stream.eventMeta');

/**
 * Attach SSE metadata to a yielded event. The metadata rides along as a
 * non-enumerable symbol, so the event still serializes and validates as its
 * plain self.
 *
 * @example
 * ```ts
 * yield withEventMeta(
 *     {
 *         type: 'progress',
 *         percent: 40,
 *     },
 *     {
 *         id: '4',
 *     }
 * );
 * ```
 */
export const withEventMeta = <Event extends object>(event: Event, meta: EventMeta): Event => {
    const tagged = { ...event } as Event;
    Object.defineProperty(tagged, EVENT_META, {
        value: meta,
        enumerable: false,
    });
    return tagged;
};

export const readEventMeta = (event: unknown): EventMeta | undefined => {
    if (!event || typeof event !== 'object') return undefined;
    return (event as { [EVENT_META]?: EventMeta })[EVENT_META];
};

/**
 * Strips CR and LF, which would end the field and corrupt the frame.
 */
const sanitizeFieldValue = (value: string): string => value.replace(/[\r\n]/g, ' ');

/**
 * The payload is split across `data:` lines so a multi-line serialization still
 * arrives as a single event.
 */
export const encodeSseChunk = (chunk: StreamChunk): string => {
    if (chunk.kind === 'comment') return ':\n\n';
    const lines: string[] = [];
    const meta = chunk.meta;
    if (meta?.event !== undefined) lines.push(`event: ${sanitizeFieldValue(meta.event)}`);
    if (meta?.id !== undefined) lines.push(`id: ${sanitizeFieldValue(meta.id)}`);
    if (meta?.retry !== undefined) lines.push(`retry: ${Math.trunc(meta.retry)}`);
    const serialized = JSON.stringify(chunk.payload) ?? 'null';
    for (const line of serialized.split('\n')) {
        lines.push(`data: ${line}`);
    }
    return `${lines.join('\n')}\n\n`;
};

/**
 * `Connection` is absent because it is the default in HTTP/1.1 and forbidden in
 * HTTP/2.
 */
export const SSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    'x-accel-buffering': 'no',
});

export const DEFAULT_KEEP_ALIVE_MS = 15_000;

const isAsyncIterable = (value: unknown): value is AsyncIterable<unknown> =>
    !!value && (typeof value === 'object' || typeof value === 'function') && Symbol.asyncIterator in value;

/**
 * A queue the writer form pushes into and the consumer drains. `emit` exists
 * before the callback runs, so events emitted synchronously are not lost.
 */
const createChunkQueue = () => {
    const queue: StreamChunk[] = [];
    let wake: (() => void) | undefined;
    let finished = false;
    let failure: { error: unknown } | undefined;

    return {
        push(chunk: StreamChunk) {
            queue.push(chunk);
            wake?.();
            wake = undefined;
        },
        settle(error?: { error: unknown }) {
            failure = error;
            finished = true;
            wake?.();
            wake = undefined;
        },
        async *drain(): AsyncGenerator<StreamChunk> {
            while (true) {
                while (queue.length > 0) {
                    yield queue.shift()!;
                }
                if (finished) break;
                await new Promise<void>((resolve) => {
                    wake = resolve;
                });
            }
            if (failure) throw failure.error;
        },
    };
};

/**
 * Normalizes either handler form into one stream of chunks.
 */
export const normalizeHandlerStream = <Event>(
    stream: HandlerStream<Event>,
    options: {
        eventName?: string;
    } = {}
): AsyncIterable<StreamChunk> => {
    // Three sources can name an event, in increasing precedence: the `eventName` field of
    // the payload, `withEventMeta` on the event, and the `meta` argument to `emit`. They
    // merge rather than override, so nothing is silently dropped when two are used.
    const toChunk = (event: Event, emitted?: EventMeta): StreamChunk => {
        const derivedName =
            options.eventName !== undefined && event && typeof event === 'object'
                ? (event as Record<string, unknown>)[options.eventName]
                : undefined;
        const resolved: EventMeta = {
            ...(typeof derivedName === 'string' ? { event: derivedName } : {}),
            ...readEventMeta(event),
            ...emitted,
        };
        return {
            kind: 'event',
            payload: event,
            ...(Object.keys(resolved).length > 0 ? { meta: resolved } : {}),
        };
    };

    return {
        async *[Symbol.asyncIterator]() {
            const chunks = createChunkQueue();
            const emit: StreamEmit<Event> = (event, meta) => {
                chunks.push(toChunk(event, meta));
            };
            // A generator function ignores `emit` and returns an iterator; a writer callback uses
            // it and returns a promise. Calling once tells the two apart.
            const produced = stream(emit);
            if (isAsyncIterable(produced)) {
                for await (const event of produced as AsyncIterable<Event>) {
                    yield toChunk(event);
                }
                return;
            }
            void Promise.resolve(produced).then(
                () => chunks.settle(),
                (error: unknown) => chunks.settle({ error })
            );
            yield* chunks.drain();
        },
    };
};

/**
 * Pulls the first chunk before any header is written, then hands back a stream that
 * replays it. This is what lets a failure while producing the first event still
 * render an ordinary Problem Details response: nothing has been committed yet, so the
 * rejection propagates to the pipeline's error handling like any other thrown error.
 *
 * The returned iterable is single-use, which is all an adapter needs.
 */
export const primeStream = async (chunks: AsyncIterable<StreamChunk>): Promise<AsyncIterable<StreamChunk>> => {
    const iterator = chunks[Symbol.asyncIterator]();
    const first = await iterator.next();
    return {
        async *[Symbol.asyncIterator]() {
            try {
                if (first.done) return;
                yield first.value;
                while (true) {
                    const next = await iterator.next();
                    if (next.done) return;
                    yield next.value;
                }
            } finally {
                await iterator.return?.();
            }
        },
    };
};

const KEEP_ALIVE_TICK: unique symbol = Symbol('ts-kizuna.stream.keepAlive');

/**
 * Yields a comment chunk whenever the source has been idle for `intervalMs`,
 * keeping the connection alive through intermediaries.
 */
export const withKeepAlive = (source: AsyncIterable<StreamChunk>, intervalMs: number): AsyncIterable<StreamChunk> => {
    if (intervalMs <= 0) return source;
    return {
        async *[Symbol.asyncIterator]() {
            const iterator = source[Symbol.asyncIterator]();
            let pending = iterator.next();
            try {
                while (true) {
                    let timer: ReturnType<typeof setTimeout> | undefined;
                    const idle = new Promise<typeof KEEP_ALIVE_TICK>((resolve) => {
                        timer = setTimeout(() => resolve(KEEP_ALIVE_TICK), intervalMs);
                    });
                    const raced = await Promise.race([pending, idle]);
                    if (timer !== undefined) clearTimeout(timer);
                    if (raced === KEEP_ALIVE_TICK) {
                        // `pending` is held across iterations; calling next() again would advance the source twice.
                        yield {
                            kind: 'comment',
                        };
                        continue;
                    }
                    if (raced.done) return;
                    yield raced.value;
                    pending = iterator.next();
                }
            } finally {
                await iterator.return?.();
            }
        },
    };
};

/**
 * Once the first chunk is enqueued the status is already on the wire, so a later
 * failure can only close the stream. `onError` sees it.
 */
export const toReadableStream = (
    chunks: AsyncIterable<StreamChunk>,
    options: {
        onError?: (error: unknown) => void;
        signal?: AbortSignal;
    } = {}
): ReadableStream<Uint8Array> => {
    const encoder = new TextEncoder();
    let iterator: AsyncIterator<StreamChunk> | undefined;
    return new ReadableStream<Uint8Array>({
        start(controller) {
            iterator = chunks[Symbol.asyncIterator]();
            options.signal?.addEventListener('abort', () => {
                void iterator?.return?.();
                try {
                    controller.close();
                } catch {
                    // Already closed by the normal path.
                }
            });
        },
        async pull(controller) {
            try {
                const next = await iterator!.next();
                if (next.done) {
                    controller.close();
                    return;
                }
                controller.enqueue(encoder.encode(encodeSseChunk(next.value)));
            } catch (error) {
                options.onError?.(error);
                controller.close();
            }
        },
        async cancel() {
            await iterator?.return?.();
        },
    });
};

/**
 * The parts of a streaming {@link AdapterResult} the transport helpers need. Keeping
 * it structural lets an adapter pass the result straight through.
 */
export interface SseSource {
    status: number;
    events: AsyncIterable<StreamChunk>;
    headers?: Record<string, string>;
}

export interface SseTransportOptions {
    onError?: (error: unknown) => void;
    signal?: AbortSignal;
}

/**
 * A failure after the first event cannot change the response, so it is reported rather
 * than rendered. An adapter's `onStreamError` gets first refusal; without one the error
 * is logged, because a stream that just stops with no trace is very hard to debug.
 */
export const reportStreamError = <NativeRequest>(
    adapterName: string,
    routeKey: string,
    error: unknown,
    request: NativeRequest,
    onStreamError?: (error: unknown, request: NativeRequest) => void
): void => {
    if (onStreamError) {
        try {
            onStreamError(error, request);
            return;
        } catch (hookError) {
            console.error(`[ts-kizuna/${adapterName}] onStreamError hook threw:`, hookError);
        }
    }
    console.error(`[ts-kizuna/${adapterName}] stream error on ${routeKey}:`, error);
};

/**
 * The response pieces for an adapter whose framework returns a `Response`. The body is
 * lazy, so nothing is read from the handler until the runtime starts pulling.
 */
export const sseResponseInit = (
    source: SseSource,
    options: SseTransportOptions = {}
): {
    status: number;
    headers: Record<string, string>;
    body: ReadableStream<Uint8Array>;
} => ({
    status: source.status,
    headers: {
        ...SSE_HEADERS,
        ...source.headers,
    },
    body: toReadableStream(source.events, options),
});

/**
 * The subset of Node's `ServerResponse` the pump needs. Express's `Response` and
 * Fastify's `reply.raw` both satisfy it.
 */
export interface NodeStreamResponse {
    writeHead: (status: number, headers: Record<string, string>) => unknown;
    write: (chunk: string) => boolean;
    end: () => unknown;
    once: (event: string, listener: () => void) => unknown;
    off: (event: string, listener: () => void) => unknown;
    readonly writableEnded: boolean;
}

/**
 * `write` returned `false`, so the socket buffer is full and the next write has to wait
 * for `drain`. It also settles on anything meaning no `drain` is ever coming, because a
 * client that disconnects mid-buffer would otherwise leave the pump waiting forever,
 * holding the handler's generator open with it.
 */
const waitForCapacity = (response: NodeStreamResponse, signal: AbortSignal | undefined): Promise<void> =>
    new Promise<void>((resolve) => {
        const settle = (): void => {
            response.off('drain', settle);
            response.off('close', settle);
            response.off('error', settle);
            signal?.removeEventListener('abort', settle);
            resolve();
        };
        response.once('drain', settle);
        response.once('close', settle);
        response.once('error', settle);
        signal?.addEventListener('abort', settle);
    });

/**
 * Writes a stream into a Node response. For adapters that own the response object
 * rather than returning a `Response`.
 */
export const pumpToNodeResponse = async (
    response: NodeStreamResponse,
    source: SseSource,
    options: SseTransportOptions = {}
): Promise<void> => {
    response.writeHead(source.status, {
        ...SSE_HEADERS,
        ...source.headers,
    });
    const iterator = source.events[Symbol.asyncIterator]();
    try {
        while (!options.signal?.aborted) {
            const next = await iterator.next();
            if (next.done) break;
            if (response.write(encodeSseChunk(next.value)) === false) {
                await waitForCapacity(response, options.signal);
            }
        }
    } catch (error) {
        options.onError?.(error);
    } finally {
        await iterator.return?.();
        if (!response.writableEnded) response.end();
    }
};
