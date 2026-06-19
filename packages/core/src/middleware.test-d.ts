import { test } from 'vitest';
import { z } from 'zod';
import type { Routes } from './types.js';
import type { MiddlewareMap } from './middleware.js';

const routes = {
    register: {
        method: 'POST',
        path: '/register',
        body: z.object({
            email: z.string(),
        }),
        responses: {
            201: z.object({
                id: z.string(),
            }),
        },
    },
    login: {
        method: 'POST',
        path: '/login',
        body: z.object({
            email: z.string(),
        }),
        responses: {
            200: z.object({
                token: z.string(),
            }),
        },
    },
    user: {
        getUser: {
            method: 'GET',
            path: '/users/:id',
            responses: {
                200: z.object({
                    id: z.string(),
                }),
            },
        },
        deleteUser: {
            method: 'DELETE',
            path: '/users/:id',
            responses: {
                204: z.undefined(),
            },
        },
    },
    billing: {
        createInvoice: {
            method: 'POST',
            path: '/invoices',
            body: z.object({
                amount: z.number(),
            }),
            responses: {
                201: z.object({
                    id: z.string(),
                }),
            },
        },
        webhook: {
            method: 'POST',
            path: '/billing/webhook',
            body: z.unknown(),
            responses: {
                200: z.object({
                    ok: z.boolean(),
                }),
            },
        },
    },
} satisfies Routes;

type Routes_ = typeof routes;
type Middleware = () => void;
const auth: Middleware = () => {};

test('all top-level keys are required', () => {
    // @ts-expect-error missing register, login, billing
    const _missing: MiddlewareMap<Routes_, Middleware> = {
        user: [auth],
    };
});

test('accepts complete map with explicit empty arrays for public routes', () => {
    const _complete: MiddlewareMap<Routes_, Middleware> = {
        register: [],
        login: [],
        user: [auth],
        billing: [auth],
    };
});

test('nested group keys are optional when using wildcard default', () => {
    const _withWildcard: MiddlewareMap<Routes_, Middleware> = {
        register: [],
        login: [],
        user: [auth],
        billing: {
            '*': [auth],
            webhook: [],
        },
    };
});

test('nested group keys are optional without wildcard', () => {
    const _partial: MiddlewareMap<Routes_, Middleware> = {
        register: [],
        login: [],
        user: {
            getUser: [auth],
        },
        billing: {
            createInvoice: [auth],
        },
    };
});
