import { expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { createContract } from './contract.js';
import { createTag } from './tag.js';

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

test('contract preserves literal method and path strings', () => {
    expectTypeOf(contract.getUser.method).toEqualTypeOf<'GET'>();
    expectTypeOf(contract.getUser.path).toEqualTypeOf<'/users/:id'>();
    expectTypeOf(contract.createUser.method).toEqualTypeOf<'POST'>();
    expectTypeOf(contract.createUser.path).toEqualTypeOf<'/users'>();
});

test('createUser has body, getUser does not', () => {
    expectTypeOf(contract.createUser.body).not.toBeUndefined();
    expectTypeOf(contract.getUser).not.toHaveProperty('body');
});

test('path must start with /', () => {
    // @ts-expect-error path must start with /
    createContract({ bad: { method: 'GET', path: 'users/:id', responses: { 200: z.string() } } });
});

const Users = createTag({
    title: 'Users',
    description: 'User management endpoints',
});

const tagged = createContract(Users, {
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

test('tagged contract preserves literal types', () => {
    expectTypeOf(tagged.getUser.method).toEqualTypeOf<'GET'>();
    expectTypeOf(tagged.getUser.path).toEqualTypeOf<'/users/:id'>();
});
