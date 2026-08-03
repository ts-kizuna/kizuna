import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { kizuna, createTags, withEventMeta } from '@ts-kizuna/core';
import { ProblemDetailsSchema } from '@ts-kizuna/core/schemas';
import { createExpressEndpoints, createServer } from './server.js';

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

const routes = k.routes('api', {
    streamGenerator: {
        method: 'GET',
        path: '/stream/generator',
        responses: {
            200: {
                stream: 'sse',
                event: ActivityEventSchema,
                eventName: 'type',
            },
        },
    },
    streamWriter: {
        method: 'GET',
        path: '/stream/writer',
        responses: {
            200: {
                stream: 'sse',
                event: ActivityEventSchema,
            },
        },
    },
    streamThrowsEarly: {
        method: 'GET',
        path: '/stream/throws-early',
        responses: {
            200: {
                stream: 'sse',
                event: ActivityEventSchema,
            },
            500: ProblemDetailsSchema,
        },
    },
    streamInvalidEvent: {
        method: 'GET',
        path: '/stream/invalid-event',
        responses: {
            200: {
                stream: 'sse',
                event: ActivityEventSchema,
            },
        },
    },
    streamEchoesLastEventId: {
        method: 'GET',
        path: '/stream/resume',
        responses: {
            200: {
                stream: 'sse',
                event: z.object({
                    resumedFrom: z.string(),
                }),
            },
        },
    },
});

const contract = k.contract({
    routes: {
        api: routes,
    },
    auth: {
        api: false,
    },
});

const { server } = createServer(contract);

const router = server.router('api', {
    streamGenerator: () => ({
        status: 200 as const,
        stream: (async function* () {
            yield withEventMeta(
                {
                    type: 'progress' as const,
                    percent: 40,
                },
                {
                    id: '1',
                }
            );
            yield {
                type: 'done' as const,
            };
        })(),
    }),
    streamWriter: () => ({
        status: 200 as const,
        stream: (emit) => {
            emit({
                type: 'progress',
                percent: 10,
            });
            emit({
                type: 'done',
            });
            return Promise.resolve();
        },
    }),
    streamThrowsEarly: () => {
        throw new Error('boom before first event');
    },
    streamInvalidEvent: () => ({
        status: 200 as const,
        stream: (async function* () {
            yield {
                type: 'progress' as const,
                percent: 'not-a-number' as unknown as number,
            };
        })(),
    }),
    streamEchoesLastEventId: ({ lastEventId }) => ({
        status: 200 as const,
        stream: (async function* () {
            yield {
                resumedFrom: lastEventId ?? 'none',
            };
        })(),
    }),
});

const api = server.api({
    router: {
        api: router,
    },
});

const app = express();
app.use(express.json());
createExpressEndpoints(api, app, {
    streamKeepAliveMs: 0,
    responseValidation: true,
});

describe('Express streaming', () => {
    it('streams a generator, naming events from eventName and carrying withEventMeta ids', async () => {
        const response = await request(app).get('/stream/generator');
        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toBe('text/event-stream');
        expect(response.headers['cache-control']).toBe('no-cache, no-transform');
        expect(response.text).toBe(
            'event: progress\nid: 1\ndata: {"type":"progress","percent":40}\n\nevent: done\ndata: {"type":"done"}\n\n'
        );
    });

    it('streams the writer form', async () => {
        const response = await request(app).get('/stream/writer');
        expect(response.status).toBe(200);
        expect(response.text).toBe('data: {"type":"progress","percent":10}\n\ndata: {"type":"done"}\n\n');
    });

    it('does not open a stream when the handler throws before the first event', async () => {
        const response = await request(app).get('/stream/throws-early');
        expect(response.status).toBe(500);
        expect(response.headers['content-type']).not.toContain('text/event-stream');
    });

    it('closes the stream when an event fails response validation', async () => {
        const response = await request(app).get('/stream/invalid-event');
        expect(response.status).toBe(200);
        expect(response.text).toBe('');
    });

    it('passes Last-Event-ID to the handler', async () => {
        const response = await request(app).get('/stream/resume').set('last-event-id', '7');
        expect(response.text).toBe('data: {"resumedFrom":"7"}\n\n');
    });

    it('accepts an EventSource Accept header', async () => {
        const response = await request(app).get('/stream/generator').set('accept', 'text/event-stream');
        expect(response.status).toBe(200);
    });

    it('returns 406 for an Accept the route cannot satisfy', async () => {
        const response = await request(app).get('/stream/generator').set('accept', 'image/png');
        expect(response.status).toBe(406);
    });
});
