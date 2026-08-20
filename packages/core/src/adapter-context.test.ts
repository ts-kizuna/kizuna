import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Kizuna } from './kizuna.js';
import { HANDLER_ARG_KEYS, adapterContextOf, assembleApi, createAdapter, type AdapterRequest } from './adapter.js';
import type { Routes } from './types.js';

const k = new Kizuna({
    tags: Kizuna.tags({
        api: 'API',
    }),
    identities: {
        user: Kizuna.identity.bearer({
            context: z.object({
                userId: z.string(),
            }),
        }),
    },
    requestContext: {
        analytics: Kizuna.requestContext({
            context: z.object({
                sessionId: z.string(),
            }),
        }),
    },
});

const contract = k.contract({
    routes: k.routes('api', {
        everything: {
            method: 'POST',
            path: '/everything/:id',
            query: z.object({
                page: z.number(),
            }),
            body: z.object({
                name: z.string(),
            }),
            responses: {
                200: z.object({
                    ok: z.boolean(),
                }),
            },
        },
    }),
    auth: {
        everything: 'user',
    },
});

// `rawBody` is kizuna's to set, so this stands in for a synthesized route.
const rawRoutes = {
    raw: {
        method: 'POST',
        path: '/raw',
        rawBody: true,
        security: [],
        responses: {
            200: z.object({
                ok: z.boolean(),
            }),
        },
    },
} as unknown as Routes;

/**
 * Drive one request through the pipeline and capture exactly what the handler
 * was given.
 */
const captureHandlerArgs = async (routeKey: 'everything' | 'raw' = 'everything'): Promise<Record<string, unknown>> => {
    let seen: Record<string, unknown> = {};

    const adapter = createAdapter<Request, unknown, { native: string }>({
        buildHandlerContext: () => ({
            native: 'from-the-adapter',
        }),
        respond: (result) => result,
    });

    const request: AdapterRequest<Request> = {
        request: new Request('http://localhost/everything/1?page=1', {
            method: 'POST',
        }),
        method: 'POST',
        resolution: {
            kind: 'core-match',
            path: routeKey === 'raw' ? '/raw' : '/everything/1',
        },
        query: {
            page: '1',
        },
        headers: {
            'content-type': 'application/json',
            authorization: 'Bearer tok',
        },
        readBody: (route) =>
            Promise.resolve(
                route.rawBody
                    ? new TextEncoder().encode('the exact bytes')
                    : {
                          name: 'Ada',
                      }
            ),
    };

    const capture = (args: Record<string, unknown>) => {
        seen = args;
        return {
            status: 200,
            body: {
                ok: true,
            },
        };
    };

    const router = {
        everything: capture,
        raw: capture,
    };

    // Through `assembleApi`, as an adapter would, so coercion plans are resolved.
    const api = assembleApi(contract, {
        router,
    });

    await adapter.handle({
        routes: routeKey === 'raw' ? rawRoutes : api.routes,
        router: router as never,
        request,
        responseContext: {},
        schemes: contract.securitySchemes,
        guards: {
            user: () => ({
                userId: 'u1',
            }),
        },
        requestContext: {
            analytics: () => ({
                sessionId: 's1',
            }),
        },
        pluginExports: {
            probe: {},
        },
    });

    return seen;
};

describe('adapterContextOf', () => {
    it('keeps only what the adapter contributed', async () => {
        const args = await captureHandlerArgs();

        expect(adapterContextOf(args)).toEqual({
            native: 'from-the-adapter',
        });
    });

    it('names every argument the pipeline adds, so the two cannot drift apart', async () => {
        // `path` only reaches a raw-body route, so both shapes are needed.
        const parsed = await captureHandlerArgs();
        const raw = await captureHandlerArgs('raw');
        const fromKizuna = [...new Set([...Object.keys(parsed), ...Object.keys(raw)])].filter((key) => key !== 'native');

        expect(fromKizuna.sort()).toEqual([...HANDLER_ARG_KEYS].sort());
    });

    it('hands a raw-body route the bytes and the path it was requested on', async () => {
        const args = await captureHandlerArgs('raw');

        expect(args.body).toBeInstanceOf(Uint8Array);
        expect(args.path).toBe('/raw');
    });
});
