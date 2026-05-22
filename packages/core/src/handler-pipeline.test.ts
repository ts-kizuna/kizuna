import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { validateRequest } from './handler-pipeline.js';
import type { RouteDefinition } from './types.js';

const makeRoute = (overrides: Partial<RouteDefinition>): RouteDefinition => ({
    method: 'GET',
    path: '/test',
    responses: {
        200: z.object({
            ok: z.boolean(),
        }),
    },
    ...overrides,
});

describe('query coercion', () => {
    it('coerces string to number', () => {
        const route = makeRoute({
            query: z.object({
                page: z.number(),
            }),
        });
        const result = validateRequest(route, {
            params: {},
            query: {
                page: '3',
            },
            body: undefined,
            headers: {},
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.parsed.query).toEqual({
                page: 3,
            });
        }
    });

    it('coerces string to int', () => {
        const route = makeRoute({
            query: z.object({
                limit: z.int(),
            }),
        });
        const result = validateRequest(route, {
            params: {},
            query: {
                limit: '10',
            },
            body: undefined,
            headers: {},
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.parsed.query).toEqual({
                limit: 10,
            });
        }
    });

    it('coerces string to boolean', () => {
        const route = makeRoute({
            query: z.object({
                active: z.boolean(),
            }),
        });
        const result = validateRequest(route, {
            params: {},
            query: {
                active: 'true',
            },
            body: undefined,
            headers: {},
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.parsed.query).toEqual({
                active: true,
            });
        }
    });

    it('coerces "false" string to boolean false', () => {
        const route = makeRoute({
            query: z.object({
                verbose: z.boolean(),
            }),
        });
        const result = validateRequest(route, {
            params: {},
            query: {
                verbose: 'false',
            },
            body: undefined,
            headers: {},
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.parsed.query).toEqual({
                verbose: false,
            });
        }
    });

    it('coerces array of number strings', () => {
        const route = makeRoute({
            query: z.object({
                ids: z.array(z.number()),
            }),
        });
        const result = validateRequest(route, {
            params: {},
            query: {
                ids: ['3', '5', '7'],
            },
            body: undefined,
            headers: {},
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.parsed.query).toEqual({
                ids: [3, 5, 7],
            });
        }
    });

    it('coerces array of boolean strings', () => {
        const route = makeRoute({
            query: z.object({
                flags: z.array(z.boolean()),
            }),
        });
        const result = validateRequest(route, {
            params: {},
            query: {
                flags: ['true', 'false'],
            },
            body: undefined,
            headers: {},
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.parsed.query).toEqual({
                flags: [true, false],
            });
        }
    });

    it('coerces through optional wrapper', () => {
        const route = makeRoute({
            query: z.object({
                page: z.number().optional(),
            }),
        });
        const result = validateRequest(route, {
            params: {},
            query: {
                page: '5',
            },
            body: undefined,
            headers: {},
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.parsed.query).toEqual({
                page: 5,
            });
        }
    });

    it('coerces through default wrapper', () => {
        const route = makeRoute({
            query: z.object({
                page: z.number().default(1),
            }),
        });
        const result = validateRequest(route, {
            params: {},
            query: {
                page: '2',
            },
            body: undefined,
            headers: {},
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.parsed.query).toEqual({
                page: 2,
            });
        }
    });

    it('coerces through nullable wrapper', () => {
        const route = makeRoute({
            query: z.object({
                count: z.number().nullable(),
            }),
        });
        const result = validateRequest(route, {
            params: {},
            query: {
                count: '42',
            },
            body: undefined,
            headers: {},
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.parsed.query).toEqual({
                count: 42,
            });
        }
    });

    it('does not coerce NaN-producing strings to number', () => {
        const route = makeRoute({
            query: z.object({
                page: z.number(),
            }),
        });
        const result = validateRequest(route, {
            params: {},
            query: {
                page: 'notanumber',
            },
            body: undefined,
            headers: {},
        });
        expect(result.ok).toBe(false);
    });

    it('leaves string fields unchanged', () => {
        const route = makeRoute({
            query: z.object({
                search: z.string(),
            }),
        });
        const result = validateRequest(route, {
            params: {},
            query: {
                search: 'hello',
            },
            body: undefined,
            headers: {},
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.parsed.query).toEqual({
                search: 'hello',
            });
        }
    });

    it('leaves enum fields unchanged', () => {
        const route = makeRoute({
            query: z.object({
                status: z.enum(['active', 'inactive']),
            }),
        });
        const result = validateRequest(route, {
            params: {},
            query: {
                status: 'active',
            },
            body: undefined,
            headers: {},
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.parsed.query).toEqual({
                status: 'active',
            });
        }
    });

    it('passes through unknown fields', () => {
        const route = makeRoute({
            query: z.object({
                page: z.number(),
            }),
        });
        const result = validateRequest(route, {
            params: {},
            query: {
                page: '1',
                extra: 'stuff',
            },
            body: undefined,
            headers: {},
        });
        expect(result.ok).toBe(true);
    });

    it('is backward-compatible with z.coerce.number()', () => {
        const route = makeRoute({
            query: z.object({
                page: z.coerce.number(),
            }),
        });
        const result = validateRequest(route, {
            params: {},
            query: {
                page: '3',
            },
            body: undefined,
            headers: {},
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.parsed.query).toEqual({
                page: 3,
            });
        }
    });
});

describe('params coercion', () => {
    it('coerces path param string to number', () => {
        const route = makeRoute({
            path: '/items/:id',
            pathParams: z.object({
                id: z.number(),
            }),
        });
        const result = validateRequest(route, {
            params: {
                id: '42',
            },
            query: {},
            body: undefined,
            headers: {},
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.parsed.params).toEqual({
                id: 42,
            });
        }
    });
});

describe('headers coercion', () => {
    it('coerces header value to number', () => {
        const route = makeRoute({
            headers: z.object({
                'x-page-size': z.number(),
            }),
        });
        const result = validateRequest(route, {
            params: {},
            query: {},
            body: undefined,
            headers: {
                'x-page-size': '25',
            },
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.parsed.headers).toEqual({
                'x-page-size': 25,
            });
        }
    });
});

describe('body is not coerced', () => {
    it('does not coerce body values', () => {
        const route = makeRoute({
            method: 'POST',
            body: z.object({
                count: z.number(),
            }),
            responses: {
                200: z.object({
                    ok: z.boolean(),
                }),
            },
        });
        const result = validateRequest(route, {
            params: {},
            query: {},
            body: {
                count: 5,
            },
            headers: {},
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.parsed.body).toEqual({
                count: 5,
            });
        }
    });

    it('fails when body has string where number is expected', () => {
        const route = makeRoute({
            method: 'POST',
            body: z.object({
                count: z.number(),
            }),
            responses: {
                200: z.object({
                    ok: z.boolean(),
                }),
            },
        });
        const result = validateRequest(route, {
            params: {},
            query: {},
            body: {
                count: '5',
            },
            headers: {},
        });
        expect(result.ok).toBe(false);
    });
});
