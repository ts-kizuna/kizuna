import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { kizuna, createTags } from './index.js';
import { ProblemDetailsSchema } from './schemas.js';
import { createAdapter, renderJsonResult, ResponseValidationError, type AdapterRequest, type AdapterResult } from './adapter.js';

const { k } = kizuna({
    tags: createTags({
        api: 'API',
    }),
});

const contract = k.routes('api', {
    getItem: {
        method: 'GET',
        path: '/items/:id',
        responses: {
            200: z.object({
                id: z.string(),
                name: z.string(),
            }),
            404: ProblemDetailsSchema,
        },
    },
});

const makeRequest = (path: string): AdapterRequest<null> => ({
    request: null,
    method: 'GET',
    resolution: {
        kind: 'core-match',
        path,
    },
    query: {},
    headers: {},
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

describe('responseValidation', () => {
    it('passes through when handler returns a body matching the response schema', async () => {
        const { adapter, results } = makeAdapter();
        await adapter.handle({
            routes: contract,
            router: {
                getItem: ({ params }: { params: { id: string } }) => ({
                    status: 200,
                    body: {
                        id: params.id,
                        name: 'Widget',
                    },
                }),
            },
            request: makeRequest('/items/1'),
            responseContext: {},
            responseValidation: true,
        });
        expect(results[0]?.kind).toBe('success');
    });

    it('produces a handler-error when handler returns a body that fails the response schema', async () => {
        const { adapter, results } = makeAdapter();
        await adapter.handle({
            routes: contract,
            router: {
                getItem: () =>
                    ({
                        status: 200,
                        body: { id: 123 },
                    }) as any,
            },
            request: makeRequest('/items/1'),
            responseContext: {},
            responseValidation: true,
        });
        expect(results[0]?.kind).toBe('handler-error');
        const result = results[0] as Extract<AdapterResult, { kind: 'handler-error' }>;
        expect(result.error).toBeInstanceOf(ResponseValidationError);
        const error = result.error as ResponseValidationError;
        expect(error.routeKey).toBe('getItem');
        expect(error.status).toBe(200);
        expect(error.issues.length).toBeGreaterThan(0);
    });

    it('does not validate when responseValidation is false', async () => {
        const { adapter, results } = makeAdapter();
        await adapter.handle({
            routes: contract,
            router: {
                getItem: () =>
                    ({
                        status: 200,
                        body: { id: 123 },
                    }) as any,
            },
            request: makeRequest('/items/1'),
            responseContext: {},
            responseValidation: false,
        });
        expect(results[0]?.kind).toBe('success');
    });

    it('does not validate when responseValidation is omitted', async () => {
        const { adapter, results } = makeAdapter();
        await adapter.handle({
            routes: contract,
            router: {
                getItem: () =>
                    ({
                        status: 200,
                        body: { id: 123 },
                    }) as any,
            },
            request: makeRequest('/items/1'),
            responseContext: {},
        });
        expect(results[0]?.kind).toBe('success');
    });

    it('validates a 404 handler body against the auto-filled Problem Details envelope', async () => {
        const { adapter, results } = makeAdapter();
        await adapter.handle({
            routes: contract,
            router: {
                // The handler supplies only `detail`; `type`/`title`/`status` are auto-filled
                // before validation, so this passes despite ProblemDetailsSchema requiring all four.
                getItem: () => ({
                    status: 404,
                    body: {
                        detail: 'Not found',
                    },
                }),
            },
            request: makeRequest('/items/missing'),
            responseContext: {},
            responseValidation: true,
        });
        expect(results[0]?.kind).toBe('success');
    });

    it('error() helper throws and adapter returns it as a response', async () => {
        const { adapter, results } = makeAdapter();
        await adapter.handle({
            routes: contract,
            router: {
                getItem: ({ error }) => {
                    return error({
                        status: 404,
                        body: {
                            detail: 'Not found',
                        },
                    });
                },
            },
            request: makeRequest('/items/1'),
            responseContext: {},
        });
        expect(results[0]?.kind).toBe('success');
        const result = results[0] as Extract<AdapterResult, { kind: 'success' }>;
        expect(result.status).toBe(404);
        expect(result.body).toEqual({
            detail: 'Not found',
        });
    });

    it('passes non-ResponseError to onError as before', async () => {
        const errors: unknown[] = [];
        const adapter = createAdapter<null, void, Record<string, never>>({
            buildHandlerContext: () => ({}),
            respond: () => {},
            onError: async (error) => {
                errors.push(error);
            },
        });
        await adapter.handle({
            routes: contract,
            router: {
                getItem: () => {
                    throw new Error('something broke');
                },
            },
            request: makeRequest('/items/1'),
            responseContext: {},
        });
        expect(errors.length).toBe(1);
        expect(errors[0]).toBeInstanceOf(Error);
        expect((errors[0] as Error).message).toBe('something broke');
    });
});

describe('renderJsonResult — error formatting', () => {
    it('emits RFC 9457 Problem Details as application/problem+json by default', () => {
        const rendered = renderJsonResult({
            kind: 'success',
            routeKey: 'getItem',
            route: contract.getItem,
            status: 404,
            body: {
                detail: 'Not found',
            },
            headers: {},
        });
        expect(rendered.status).toBe(404);
        expect(rendered.headers['content-type']).toBe('application/problem+json');
        expect(rendered.body).toEqual({
            type: 'about:blank',
            title: 'Not Found',
            status: 404,
            detail: 'Not found',
        });
    });

    it('carries extension members through onto the problem body', () => {
        const rendered = renderJsonResult({
            kind: 'success',
            routeKey: 'getItem',
            route: contract.getItem,
            status: 409,
            body: {
                detail: 'Conflict',
                conflictingId: 'item_1',
            },
            headers: {},
        });
        expect(rendered.body).toMatchObject({
            status: 409,
            detail: 'Conflict',
            conflictingId: 'item_1',
        });
    });

    it('routes errors through a custom formatError — legacy shape + content-type', () => {
        // A team migrating onto kizuna keeps its old wire shape for clients that cannot
        // move yet; the canonical Problem Details object is reshaped, not bypassed.
        const rendered = renderJsonResult(
            {
                kind: 'not-found',
            },
            (problem) => ({
                contentType: 'application/json',
                body: {
                    ok: false,
                    error: {
                        code: problem.status,
                        message: problem.detail,
                    },
                },
            })
        );
        expect(rendered.status).toBe(404);
        expect(rendered.headers['content-type']).toBe('application/json');
        expect(rendered.body).toEqual({
            ok: false,
            error: {
                code: 404,
                message: 'Not Found',
            },
        });
    });

    it('does not reshape success responses', () => {
        const rendered = renderJsonResult(
            {
                kind: 'success',
                routeKey: 'getItem',
                route: contract.getItem,
                status: 200,
                body: {
                    id: '1',
                    name: 'Item',
                },
                headers: {},
            },
            () => ({
                contentType: 'application/json',
                body: 'should-not-be-used',
            })
        );
        expect(rendered.headers['content-type']).toBe('application/json');
        expect(rendered.body).toEqual({
            id: '1',
            name: 'Item',
        });
    });
});

describe('eachRoute', () => {
    it('yields static routes before parameterized routes at the same path segment', () => {
        const c = k.routes('api', {
            getById: {
                method: 'GET',
                path: '/items/:id',
                responses: { 200: z.object({ id: z.string() }) },
            },
            getMine: {
                method: 'GET',
                path: '/items/mine',
                responses: { 200: z.object({ id: z.string() }) },
            },
        });

        const { adapter } = makeAdapter();
        const router = {
            getById: async () => ({ status: 200 as const, body: { id: '1' } }),
            getMine: async () => ({ status: 200 as const, body: { id: 'me' } }),
        };

        const keys = [...adapter.eachRoute(c, router)].map((r) => r.routeKey);
        expect(keys).toEqual(['getMine', 'getById']);
    });
});

describe('renderJsonResult — non-JSON and binary bodies', () => {
    const rawContract = k.routes('api', {
        exportCsv: {
            method: 'GET',
            path: '/export',
            responses: {
                200: {
                    body: z.string(),
                    contentType: 'text/csv',
                },
            },
        },
        downloadBadge: {
            method: 'GET',
            path: '/badge',
            responses: {
                200: {
                    body: z.instanceof(Uint8Array),
                    contentType: 'application/pdf',
                },
            },
        },
    });

    it('sends a string body raw under the declared content type', () => {
        const rendered = renderJsonResult({
            kind: 'success',
            routeKey: 'exportCsv',
            route: rawContract.exportCsv,
            status: 200,
            body: 'id,name\n1,Ada',
            headers: {},
        });
        expect(rendered.raw).toBe(true);
        expect(rendered.headers['content-type']).toBe('text/csv');
        expect(rendered.body).toBe('id,name\n1,Ada');
    });

    it('sends a binary body raw, defaulting BinarySchema content type', () => {
        const rendered = renderJsonResult({
            kind: 'success',
            routeKey: 'downloadBadge',
            route: rawContract.downloadBadge,
            status: 200,
            body: Buffer.from([1, 2, 3]),
            headers: {},
        });
        expect(rendered.raw).toBe(true);
        expect(rendered.headers['content-type']).toBe('application/pdf');
        expect(rendered.body).toBeInstanceOf(Uint8Array);
    });

    it('throws a clear error when a raw route returns a non-string, non-binary body', () => {
        expect(() =>
            renderJsonResult({
                kind: 'success',
                routeKey: 'exportCsv',
                route: rawContract.exportCsv,
                status: 200,
                body: {
                    rows: [],
                },
                headers: {},
            })
        ).toThrow(/must be a string or Uint8Array/);
    });
});
