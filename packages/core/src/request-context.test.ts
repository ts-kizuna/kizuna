import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createAdapter, type AdapterRequest, type AdapterResult, type RequestContextMap, type GuardMap } from './adapter.js';
import { Kizuna } from './kizuna.js';

const user = Kizuna.identity.bearer({
    context: z.object({
        userId: z.string(),
    }),
});

const k = new Kizuna({
    identities: {
        user,
    },
    requestContext: {
        analytics: Kizuna.requestContext(
            z.object({
                sessionId: z.string().nullable(),
            })
        ),
    },
});

const contract = k.contract({
    routes: {
        api: k.routes({
            publicRoute: {
                method: 'GET',
                path: '/public',
                responses: {
                    200: z.object({
                        ok: z.boolean(),
                    }),
                },
            },
            whoAmI: {
                method: 'GET',
                path: '/users/:id',
                responses: {
                    200: z.object({
                        ok: z.boolean(),
                    }),
                },
            },
        }),
    },
    access: {
        api: {
            '*': false,
            whoAmI: 'user',
        },
    },
});

const makeRequest = (path: string, headers: Record<string, string> = {}): AdapterRequest<null> => ({
    request: null,
    method: 'GET',
    resolution: {
        kind: 'core-match',
        path,
    },
    query: {},
    headers,
    readBody: () => undefined,
});

const makeAdapter = () => {
    const results: AdapterResult[] = [];
    const adapter = createAdapter<null, void, Record<string, never>>({
        buildHandlerContext: () => ({}),
        respond: (result) => {
            results.push(result);
        },
    });
    return { adapter, results };
};

const okHandler = () => ({
    status: 200 as const,
    body: {
        ok: true,
    },
});

describe('request context providers', () => {
    const analytics: RequestContextMap<Record<string, never>> = {
        analytics: ({ params }) => ({
            sessionId: (params as Record<string, string>).id ?? null,
        }),
    };

    it('runs on public routes and lands under requestContext by provider name', async () => {
        const { adapter, results } = makeAdapter();
        let received: unknown;
        await adapter.handle({
            routes: contract.routes,
            router: {
                api: {
                    publicRoute: (args: Record<string, unknown>) => {
                        received = (args.requestContext as Record<string, unknown>).analytics;
                        return okHandler();
                    },
                    whoAmI: okHandler,
                },
            },
            request: makeRequest('/public'),
            responseContext: {},
            requestContext: analytics,
        });
        expect(results[0]?.kind).toBe('success');
        expect(received).toEqual({
            sessionId: null,
        });
    });

    it('runs alongside guards on secured routes and receives params', async () => {
        const { adapter, results } = makeAdapter();
        let received: unknown;
        await adapter.handle({
            routes: contract.routes,
            router: {
                api: {
                    publicRoute: okHandler,
                    whoAmI: (args: Record<string, unknown>) => {
                        received = (args.requestContext as Record<string, unknown>).analytics;
                        return okHandler();
                    },
                },
            },
            request: makeRequest('/users/42', {
                authorization: 'Bearer tok',
            }),
            responseContext: {},
            guards: {
                user: () => ({
                    userId: '1',
                }),
            } as GuardMap<Record<string, never>>,
            schemes: contract.securitySchemes,
            requestContext: analytics,
        });
        expect(results[0]?.kind).toBe('success');
        expect(received).toEqual({
            sessionId: '42',
        });
    });
});
