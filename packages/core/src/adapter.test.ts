import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createContract } from './index.js';
import { createAdapter, ResponseValidationError, type AdapterRequest, type AdapterResult } from './adapter.js';

const contract = createContract({
    getItem: {
        method: 'GET',
        path: '/items/:id',
        responses: {
            200: z.object({
                id: z.string(),
                name: z.string(),
            }),
            404: z.object({
                message: z.string(),
            }),
        },
    },
});

const contractWithBody = createContract({
    createItem: {
        method: 'POST',
        path: '/items',
        body: z.object({
            name: z.string().min(1),
        }),
        responses: {
            201: z.object({
                id: z.string(),
            }),
            400: z.object({
                errors: z.record(z.string(), z.string()),
            }),
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
            contract,
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
            contract,
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
            contract,
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
            contract,
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

    it('passes validationError to handler on body validation failure', async () => {
        const { adapter, results } = makeAdapter();
        await adapter.handle({
            contract: contractWithBody,
            router: {
                createItem: ({ validationError }: { validationError?: { issues: Array<{ path: PropertyKey[]; message: string }> } }) => {
                    if (validationError) {
                        const errors: Record<string, string> = {};
                        for (const issue of validationError.issues) {
                            errors[String(issue.path[0])] = issue.message;
                        }
                        return {
                            status: 400,
                            body: {
                                errors,
                            },
                        };
                    }
                    return {
                        status: 201,
                        body: {
                            id: '1',
                        },
                    };
                },
            },
            request: {
                request: null,
                method: 'POST',
                resolution: {
                    kind: 'core-match' as const,
                    path: '/items',
                },
                query: {},
                headers: {
                    'content-type': 'application/json',
                },
                readBody: () => ({ name: '' }),
            },
            responseContext: {},
        });
        expect(results[0]?.kind).toBe('success');
        const result = results[0] as Extract<AdapterResult, { kind: 'success' }>;
        expect(result.status).toBe(400);
        expect(result.body).toEqual({
            errors: {
                name: expect.any(String),
            },
        });
    });

    it('falls back to default validation error when handler ignores validationError', async () => {
        const { adapter, results } = makeAdapter();
        await adapter.handle({
            contract: contractWithBody,
            router: {
                createItem: () => ({
                    status: 201,
                    body: {
                        id: '1',
                    },
                }),
            },
            request: {
                request: null,
                method: 'POST',
                resolution: {
                    kind: 'core-match' as const,
                    path: '/items',
                },
                query: {},
                headers: {
                    'content-type': 'application/json',
                },
                readBody: () => ({ name: '' }),
            },
            responseContext: {},
        });
        expect(results[0]?.kind).toBe('validation-failed');
    });

    it('passes through a valid 404 response', async () => {
        const { adapter, results } = makeAdapter();
        await adapter.handle({
            contract,
            router: {
                getItem: () => ({
                    status: 404,
                    body: {
                        message: 'Not found',
                    },
                }),
            },
            request: makeRequest('/items/missing'),
            responseContext: {},
            responseValidation: true,
        });
        expect(results[0]?.kind).toBe('success');
    });
});
