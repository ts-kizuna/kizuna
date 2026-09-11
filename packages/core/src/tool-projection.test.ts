import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { routeToolAnnotations, routeToolInput, routeToolOutput } from './tool-projection.js';
import type { RouteDefinition } from './types.js';

const route = (definition: Partial<RouteDefinition> & Pick<RouteDefinition, 'method' | 'path' | 'responses'>): RouteDefinition =>
    definition as RouteDefinition;

const shapeOf = (schema: z.ZodType | undefined): Record<string, unknown> =>
    (z.toJSONSchema(schema!, { io: 'input' }) as { properties?: Record<string, unknown> }).properties ?? {};

const requiredOf = (schema: z.ZodType | undefined): string[] =>
    (z.toJSONSchema(schema!, { io: 'input' }) as { required?: string[] }).required ?? [];

describe('routeToolInput', () => {
    it('puts query under a query key', () => {
        const input = routeToolInput(
            route({
                method: 'GET',
                path: '/users',
                query: z.object({
                    limit: z.coerce.number().optional(),
                }),
                responses: {},
            })
        );

        expect(Object.keys(shapeOf(input))).toEqual(['query']);
    });

    it('leaves an all-optional query out of required', () => {
        const input = routeToolInput(
            route({
                method: 'GET',
                path: '/users',
                query: z.object({
                    limit: z.coerce.number().optional(),
                }),
                responses: {},
            })
        );

        expect(requiredOf(input)).not.toContain('query');
    });

    it('keeps a query with a required field required', () => {
        const input = routeToolInput(
            route({
                method: 'GET',
                path: '/users',
                query: z.object({
                    cursor: z.string(),
                }),
                responses: {},
            })
        );

        expect(requiredOf(input)).toContain('query');
    });

    it('puts path params under a params key, as strings when undeclared', () => {
        const input = routeToolInput(
            route({
                method: 'GET',
                path: '/users/:id',
                responses: {},
            })
        );

        const params = shapeOf(input)['params'] as { properties: Record<string, unknown>; required: string[] };
        expect(Object.keys(params.properties)).toEqual(['id']);
        expect(params.required).toEqual(['id']);
    });

    it('puts body under a body key', () => {
        const input = routeToolInput(
            route({
                method: 'POST',
                path: '/users',
                body: z.object({
                    name: z.string(),
                }),
                responses: {},
            })
        );

        expect(Object.keys(shapeOf(input))).toEqual(['body']);
    });

    it('leaves a void body out entirely', () => {
        const input = routeToolInput(
            route({
                method: 'POST',
                path: '/users/:id/ping',
                body: z.void(),
                responses: {},
            })
        );

        expect(Object.keys(shapeOf(input))).toEqual(['params']);
    });

    it('takes a body that is not an object', () => {
        const input = routeToolInput(
            route({
                method: 'POST',
                path: '/events',
                body: z.discriminatedUnion('kind', [
                    z.object({ kind: z.literal('click'), x: z.int() }),
                    z.object({ kind: z.literal('key'), code: z.string() }),
                ]),
                responses: {},
            })
        );

        expect(Object.keys(shapeOf(input))).toEqual(['body']);
    });

    it('combines params, query and body', () => {
        const input = routeToolInput(
            route({
                method: 'PATCH',
                path: '/users/:id',
                query: z.object({ notify: z.string() }),
                body: z.object({ name: z.string() }),
                responses: {},
            })
        );

        expect(Object.keys(shapeOf(input))).toEqual(['params', 'query', 'body']);
    });

    it('answers undefined for a route that takes nothing', () => {
        expect(
            routeToolInput(
                route({
                    method: 'GET',
                    path: '/health',
                    responses: {},
                })
            )
        ).toBeUndefined();
    });
});

describe('routeToolOutput', () => {
    it('takes the body from the success response, not the error one', () => {
        const output = routeToolOutput(
            route({
                method: 'GET',
                path: '/users/:id',
                responses: {
                    200: z.object({ id: z.string() }),
                    404: z.object({ detail: z.string() }),
                },
            })
        );

        expect(output.safeParse({ status: 200, body: { id: '1' } }).success).toBe(true);
        expect(output.safeParse({ status: 404, body: { detail: 'nope' } }).success).toBe(false);
    });

    it('carries several success statuses in one envelope', () => {
        const output = routeToolOutput(
            route({
                method: 'POST',
                path: '/users',
                responses: {
                    200: z.object({ id: z.string() }),
                    201: z.object({ id: z.string(), created: z.boolean() }),
                },
            })
        );

        expect(output.safeParse({ status: 200, body: { id: '1' } }).success).toBe(true);
        expect(output.safeParse({ status: 201, body: { id: '1', created: true } }).success).toBe(true);
    });

    it('answers with status alone when no success carries a body', () => {
        const output = routeToolOutput(
            route({
                method: 'DELETE',
                path: '/users/:id',
                responses: {
                    204: z.void(),
                },
            })
        );

        expect(output.safeParse({ status: 204 }).success).toBe(true);
    });

    it('makes the body optional when one success answers without one', () => {
        const output = routeToolOutput(
            route({
                method: 'POST',
                path: '/users',
                responses: {
                    201: z.object({ id: z.string() }),
                    204: z.void(),
                },
            })
        );

        expect(output.safeParse({ status: 204 }).success).toBe(true);
        expect(output.safeParse({ status: 201, body: { id: '1' } }).success).toBe(true);
    });
});

describe('routeToolAnnotations', () => {
    it('reads safety and idempotence from the method, per RFC 9110', () => {
        const responses = { 200: z.object({ ok: z.boolean() }) };

        expect(routeToolAnnotations(route({ method: 'GET', path: '/a', responses }))).toEqual({
            readOnlyHint: true,
            idempotentHint: true,
        });
        expect(routeToolAnnotations(route({ method: 'PUT', path: '/a', responses }))).toEqual({
            idempotentHint: true,
        });
        expect(routeToolAnnotations(route({ method: 'DELETE', path: '/a', responses }))).toEqual({
            idempotentHint: true,
            destructiveHint: true,
        });
        expect(routeToolAnnotations(route({ method: 'POST', path: '/a', responses }))).toEqual({});
    });
});
