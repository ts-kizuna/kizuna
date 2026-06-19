import { expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { tagRoutes } from './routes.js';
import { createTags } from './tags.js';

const routes = tagRoutes({
    getUser: {
        method: 'GET',
        path: '/users/:id',
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
    createUser: {
        method: 'POST',
        path: '/users',
        body: z.object({
            name: z.string(),
        }),
        responses: {
            201: z.object({
                id: z.string(),
            }),
        },
    },
});

test('routes preserves literal method and path strings', () => {
    expectTypeOf(routes.getUser.method).toEqualTypeOf<'GET'>();
    expectTypeOf(routes.getUser.path).toEqualTypeOf<'/users/:id'>();
    expectTypeOf(routes.createUser.method).toEqualTypeOf<'POST'>();
    expectTypeOf(routes.createUser.path).toEqualTypeOf<'/users'>();
});

test('createUser has body, getUser does not', () => {
    expectTypeOf(routes.createUser.body).not.toBeUndefined();
    expectTypeOf(routes.getUser).not.toHaveProperty('body');
});

test('path must start with /', () => {
    // @ts-expect-error path must start with /
    tagRoutes({ bad: { method: 'GET', path: 'users/:id', responses: { 200: z.string() } } });
});

const tags = createTags({
    users: {
        title: 'Users',
        description: 'User management endpoints',
    },
    health: {
        title: 'Health',
    },
});

const tagged = tagRoutes(tags, 'users', {
    getUser: {
        method: 'GET',
        path: '/users/:id',
        tags: ['health'],
        responses: {
            200: z.object({
                id: z.string(),
            }),
        },
    },
});

test('tagged routes preserves literal types', () => {
    expectTypeOf(tagged.getUser.method).toEqualTypeOf<'GET'>();
    expectTypeOf(tagged.getUser.path).toEqualTypeOf<'/users/:id'>();
});

test('group key must be a declared tag key', () => {
    // @ts-expect-error 'unknown' is not a declared tag key
    tagRoutes(tags, 'unknown', {
        getUser: {
            method: 'GET',
            path: '/users/:id',
            responses: {
                200: z.object({
                    id: z.string(),
                }),
            },
        },
    });
});

test('route-level tags must be declared tag keys', () => {
    tagRoutes(tags, 'users', {
        getUser: {
            method: 'GET',
            path: '/users/:id',
            // @ts-expect-error 'unknown' is not a declared tag key
            tags: ['unknown'],
            responses: {
                200: z.object({
                    id: z.string(),
                }),
            },
        },
    });
});

test('tagless tagRoutes accepts arbitrary tag strings', () => {
    tagRoutes({
        getUser: {
            method: 'GET',
            path: '/users/:id',
            tags: ['anything'],
            responses: {
                200: z.object({
                    id: z.string(),
                }),
            },
        },
    });
});
