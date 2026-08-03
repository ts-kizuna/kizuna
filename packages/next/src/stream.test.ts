import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { kizuna, createTags, withEventMeta } from '@ts-kizuna/core';
import { ProblemDetailsSchema } from '@ts-kizuna/core/schemas';
import { createNextEndpoints, createServer, NextRequest } from './index.js';

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
        stream: async function* () {
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
        },
    }),
    streamWriter: () => ({
        status: 200 as const,
        stream: (emit) => {
            emit({
                type: 'progress',
                percent: 10,
            });
            return Promise.resolve();
        },
    }),
    streamThrowsEarly: () => {
        throw new Error('boom before first event');
    },
});

const api = server.api({
    router: {
        api: router,
    },
});

const { GET } = createNextEndpoints(api, {
    basePath: '',
    streamKeepAliveMs: 0,
    responseValidation: true,
});

const makeRequest = (path: string, headers?: Record<string, string>): NextRequest =>
    new NextRequest(`http://localhost:3000${path}`, {
        method: 'GET',
        ...(headers ? { headers } : {}),
    });

describe('Next.js streaming', () => {
    it('streams a generator, naming events from eventName and carrying withEventMeta ids', async () => {
        const response = await GET(makeRequest('/stream/generator'));
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('text/event-stream');
        expect(await response.text()).toBe(
            'event: progress\nid: 1\ndata: {"type":"progress","percent":40}\n\nevent: done\ndata: {"type":"done"}\n\n'
        );
    });

    it('streams the writer form', async () => {
        const response = await GET(makeRequest('/stream/writer'));
        expect(await response.text()).toBe('data: {"type":"progress","percent":10}\n\n');
    });

    it('does not open a stream when the handler throws before the first event', async () => {
        const response = await GET(makeRequest('/stream/throws-early'));
        expect(response.status).toBe(500);
        expect(response.headers.get('content-type')).not.toContain('text/event-stream');
    });

    it('accepts an EventSource Accept header', async () => {
        const response = await GET(
            makeRequest('/stream/generator', {
                accept: 'text/event-stream',
            })
        );
        expect(response.status).toBe(200);
    });

    it('returns 406 for an Accept the route cannot satisfy', async () => {
        const response = await GET(
            makeRequest('/stream/generator', {
                accept: 'image/png',
            })
        );
        expect(response.status).toBe(406);
    });
});
