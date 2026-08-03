import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { kizuna, createTags } from '@ts-kizuna/core';
import { ProblemDetailsSchema } from '@ts-kizuna/core/schemas';
import { createClient } from './client.js';

const { k } = kizuna({
    tags: createTags({
        api: 'API',
    }),
});

const ActivityEventSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('progress'),
        percent: z.number(),
    }),
    z.object({
        type: z.literal('done'),
    }),
]);

const contract = k.contract({
    routes: {
        api: k.routes('api', {
            streamActivity: {
                method: 'GET',
                path: '/activity',
                responses: {
                    200: {
                        stream: 'sse',
                        event: ActivityEventSchema,
                    },
                    404: ProblemDetailsSchema,
                },
            },
        }),
    },
    auth: {
        api: false,
    },
});

const sseResponse = (body: string, status = 200): Response =>
    new Response(body, {
        status,
        headers: {
            'content-type': 'text/event-stream',
        },
    });

const clientWith = (respond: () => Response) =>
    createClient(contract, {
        baseUrl: 'https://api.test',
        fetch: () => Promise.resolve(respond()),
    });

describe('createClient streaming', () => {
    it('exposes events as a typed async sequence', async () => {
        const client = clientWith(() =>
            sseResponse('event: progress\ndata: {"type":"progress","percent":40}\n\nevent: done\ndata: {"type":"done"}\n\n')
        );
        const result = await client.api.streamActivity();
        expect(result.status).toBe(200);
        if (result.status !== 200) throw new Error('expected 200');

        const seen: Array<z.infer<typeof ActivityEventSchema>> = [];
        for await (const event of result.stream) seen.push(event);

        expect(seen).toEqual([
            {
                type: 'progress',
                percent: 40,
            },
            {
                type: 'done',
            },
        ]);
    });

    it('keeps the buffered JSON path for error statuses', async () => {
        const client = clientWith(
            () =>
                new Response(
                    JSON.stringify({
                        type: 'about:blank',
                        title: 'Not Found',
                        status: 404,
                        detail: 'No activity',
                    }),
                    {
                        status: 404,
                        headers: {
                            'content-type': 'application/problem+json',
                        },
                    }
                )
        );
        const result = await client.api.streamActivity();
        expect(result.status).toBe(404);
        if (result.status !== 404) throw new Error('expected 404');
        expect(result.body.detail).toBe('No activity');
    });

    it('stops reading when the caller breaks out of the loop', async () => {
        let cancelled = false;
        const client = clientWith(() => {
            const encoder = new TextEncoder();
            const body = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(encoder.encode('data: {"type":"progress","percent":1}\n\n'));
                    controller.enqueue(encoder.encode('data: {"type":"progress","percent":2}\n\n'));
                },
                cancel() {
                    cancelled = true;
                },
            });
            return new Response(body, {
                status: 200,
                headers: {
                    'content-type': 'text/event-stream',
                },
            });
        });

        const result = await client.api.streamActivity();
        if (result.status !== 200) throw new Error('expected 200');
        for await (const event of result.stream) {
            expect(event).toEqual({
                type: 'progress',
                percent: 1,
            });
            break;
        }
        expect(cancelled).toBe(true);
    });
});
