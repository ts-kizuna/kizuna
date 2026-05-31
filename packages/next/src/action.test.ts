import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createContract, isValidationError } from '@ts-kizuna/core';
import { createClient } from '@ts-kizuna/fetch';
import { createServerAction } from './action.js';

const contract = createContract({
    getUser: {
        method: 'GET',
        path: '/users/:id',
        responses: {
            200: z.object({
                id: z.string(),
                name: z.string(),
            }),
            404: z.object({
                detail: z.string(),
            }),
        },
    },
    createUser: {
        method: 'POST',
        path: '/users',
        body: z.object({
            name: z.string(),
        }),
        responses: {
            201: z.object({
                id: z.string(),
                name: z.string(),
            }),
            400: z.object({
                detail: z.string(),
            }),
        },
    },
    deleteUser: {
        method: 'DELETE',
        path: '/users/:id',
        responses: {
            204: z.void(),
        },
    },
    createPost: {
        method: 'POST',
        path: '/posts',
        body: z.object({
            title: z.string(),
            authorId: z.string(),
        }),
        responses: {
            201: z.object({
                id: z.string(),
            }),
        },
    },
});

const jsonResponse = (status: number, body?: unknown): Response =>
    new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: {
            'content-type': 'application/json',
        },
    });

const makeClient = (fetchImpl: typeof fetch) =>
    createClient(contract, {
        baseUrl: 'http://test',
        fetch: fetchImpl,
    });

beforeEach(() => {
    vi.clearAllMocks();
});

describe('createServerAction', () => {
    it('resolves a 2xx response to { ok: true, data }', async () => {
        const client = makeClient(async () => jsonResponse(201, { id: '1', name: 'Ada' }));
        const createUser = createServerAction(client.createUser);

        const result = await createUser({
            body: {
                name: 'Ada',
            },
        });

        expect(result).toEqual({
            ok: true,
            status: 201,
            data: {
                id: '1',
                name: 'Ada',
            },
        });
    });

    it('resolves a 204 (no body) to { ok: true, data: undefined }', async () => {
        const client = makeClient(async () => jsonResponse(204));
        const deleteUser = createServerAction(client.deleteUser);

        const result = await deleteUser({
            params: {
                id: '1',
            },
        });

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('expected success');
        expect(result.status).toBe(204);
        expect(result.data).toBeUndefined();
    });

    it('resolves an error status to { ok: false, status, error }', async () => {
        const client = makeClient(async () => jsonResponse(404, { detail: 'Not found' }));
        const getUser = createServerAction(client.getUser);

        const result = await getUser({
            params: {
                id: 'missing',
            },
        });

        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('expected failure');
        expect(result.status).toBe(404);
        expect(result.error).toEqual({
            detail: 'Not found',
        });
    });

    it('preserves field-level validation errors', async () => {
        const validationBody = {
            type: 'about:blank',
            title: 'Bad Request',
            status: 400,
            detail: 'Request validation failed',
            errors: [
                {
                    code: 'invalid_format',
                    path: ['email'],
                    message: 'Invalid email',
                },
            ],
        };
        const client = makeClient(async () => jsonResponse(400, validationBody));
        const createUser = createServerAction(client.createUser);

        const result = await createUser({
            body: {
                name: 'Ada',
            },
        });

        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('expected failure');
        expect(result.status).toBe(400);
        expect(isValidationError(result.error)).toBe(true);
        if (!isValidationError(result.error)) throw new Error('expected validation error');
        expect(result.error.errors[0]?.path).toEqual(['email']);
        expect(result.error.errors[0]?.code).toBe('invalid_format');
    });

    it('returns the raw response union with { raw: true }', async () => {
        const client = makeClient(async () => jsonResponse(201, { id: '1', name: 'Ada' }));
        const createUser = createServerAction(client.createUser, {
            raw: true,
        });

        const result = await createUser({
            body: {
                name: 'Ada',
            },
        });

        expect(result.status).toBe(201);
        expect(result.body).toEqual({
            id: '1',
            name: 'Ada',
        });
    });

    it('propagates a thrown fetch error', async () => {
        const client = makeClient(async () => {
            throw new Error('network down');
        });
        const getUser = createServerAction(client.getUser);

        await expect(
            getUser({
                params: {
                    id: '1',
                },
            })
        ).rejects.toThrow('network down');
    });

    it('catches a thrown error via onError as { ok: false, status: 0 }', async () => {
        const client = makeClient(async () => {
            throw new Error('network down');
        });
        const getUser = createServerAction(client.getUser, {
            onError: (error) => `unreachable: ${(error as Error).message}`,
        });

        const result = await getUser({
            params: {
                id: '1',
            },
        });

        expect(result).toEqual({
            ok: false,
            status: 0,
            error: 'unreachable: network down',
        });
    });

    it('merges injected fields and drops them from the caller args', async () => {
        const sent: Array<unknown> = [];
        const client = makeClient(async (_url, init) => {
            sent.push(JSON.parse(String(init?.body ?? 'null')));
            return jsonResponse(201, { id: '1' });
        });
        const createPost = createServerAction(client.createPost, {
            inject: async () => ({
                body: {
                    authorId: 'user-1',
                },
            }),
        });

        const result = await createPost({
            body: {
                title: 'Hello',
            },
        });

        expect(sent[0]).toEqual({
            title: 'Hello',
            authorId: 'user-1',
        });
        expect(result).toEqual({
            ok: true,
            status: 201,
            data: {
                id: '1',
            },
        });
    });

    it('runs onSuccess with the data on success, but not on an error response', async () => {
        const seen: Array<unknown> = [];
        const okClient = makeClient(async () => jsonResponse(201, { id: '1', name: 'Ada' }));
        const okAction = createServerAction(okClient.createUser, {
            onSuccess: (data) => {
                seen.push(data);
            },
        });
        await okAction({
            body: {
                name: 'Ada',
            },
        });
        expect(seen).toEqual([{ id: '1', name: 'Ada' }]);

        const errorClient = makeClient(async () => jsonResponse(404, { detail: 'nope' }));
        const errorAction = createServerAction(errorClient.getUser, {
            onSuccess: () => {
                seen.push('should-not-run');
            },
        });
        await errorAction({
            params: {
                id: '1',
            },
        });
        expect(seen).toEqual([{ id: '1', name: 'Ada' }]);
    });

    it('forwards arguments to the client method', async () => {
        const calls: Array<{ url: string; method?: string }> = [];
        const client = makeClient(async (url, init) => {
            calls.push({
                url: String(url),
                method: init?.method,
            });
            return jsonResponse(200, { id: '42', name: 'Ada' });
        });
        const getUser = createServerAction(client.getUser);

        await getUser({
            params: {
                id: '42',
            },
        });

        expect(calls[0]?.url).toContain('/users/42');
        expect(calls[0]?.method).toBe('GET');
    });
});
