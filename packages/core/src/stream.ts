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
 * The shapes a handler may return under `stream`: an async generator function
 * (the yields are typed against the response's `event` schema), an already-created
 * async iterable, or a callback that receives {@link StreamEmit}.
 */
export type HandlerStream<Event> = AsyncIterable<Event> | ((emit: StreamEmit<Event>) => AsyncIterable<Event> | Promise<void> | void);

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
export const sseHeaders = (): Record<string, string> => ({
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
    const toChunk = (event: Event, meta?: EventMeta): StreamChunk => {
        const attached = meta ?? readEventMeta(event);
        const name =
            options.eventName !== undefined && event && typeof event === 'object'
                ? (event as Record<string, unknown>)[options.eventName]
                : undefined;
        const resolved: EventMeta = {
            ...(typeof name === 'string' ? { event: name } : {}),
            ...(attached ?? {}),
        };
        return {
            kind: 'event',
            payload: event,
            ...(Object.keys(resolved).length > 0 ? { meta: resolved } : {}),
        };
    };

    const iterate = (source: AsyncIterable<Event>): AsyncIterable<StreamChunk> => ({
        async *[Symbol.asyncIterator]() {
            for await (const event of source) {
                yield toChunk(event);
            }
        },
    });

    if (typeof stream !== 'function') return iterate(stream);

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
                yield* iterate(produced as AsyncIterable<Event>);
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
 * For adapters that own a Node response object rather than returning a
 * `Response`. A `false` return from `write` means the socket buffer is full, so
 * the next write waits on `drain`.
 */
export const pumpChunks = async (
    chunks: AsyncIterable<StreamChunk>,
    write: (frame: string) => boolean | void,
    options: {
        drain?: () => Promise<void>;
        onError?: (error: unknown) => void;
        signal?: AbortSignal;
    } = {}
): Promise<void> => {
    const iterator = chunks[Symbol.asyncIterator]();
    try {
        while (true) {
            if (options.signal?.aborted) break;
            const next = await iterator.next();
            if (next.done) break;
            const flushed = write(encodeSseChunk(next.value));
            if (flushed === false && options.drain) await options.drain();
        }
    } catch (error) {
        options.onError?.(error);
    } finally {
        await iterator.return?.();
    }
};
