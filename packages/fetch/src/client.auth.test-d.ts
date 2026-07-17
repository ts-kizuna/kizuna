import { test } from 'vitest';
import { z } from 'zod';
import { kizuna, createTags, createIdentity } from '@ts-kizuna/core';
import { createClient } from './client.js';

const user = createIdentity.bearer({
    context: z.object({
        userId: z.string(),
    }),
});

const member = createIdentity.apiKey({
    name: 'x-workspace-token',
    in: 'header',
});

const admin = createIdentity.basic({
    context: z.object({
        adminId: z.string(),
    }),
});

const inviteToken = createIdentity.custom({
    context: z.object({
        inviteId: z.string(),
    }),
});

const { k } = kizuna({
    identities: {
        user,
        member,
        admin,
        inviteToken,
    },
    tags: createTags({
        api: 'API',
    }),
});

const routes = k.routes('api', {
    bearerRoute: {
        method: 'GET',
        path: '/bearer',
        responses: {
            200: z.object({ ok: z.boolean() }),
        },
    },
    basicRoute: {
        method: 'GET',
        path: '/basic',
        responses: {
            200: z.object({ ok: z.boolean() }),
        },
    },
    inviteRoute: {
        method: 'GET',
        path: '/invites/:token',
        responses: {
            200: z.object({ ok: z.boolean() }),
        },
    },
});

const auth = k.auth(routes, {
    bearerRoute: 'user',
    basicRoute: 'admin',
    inviteRoute: 'inviteToken',
});

const contract = k.contract({
    routes,
    auth,
});

test('a bearer provider yields a string and a basic provider yields credentials', () => {
    createClient(contract, {
        baseUrl: 'http://localhost',
        auth: {
            user: () => 'token',
            admin: () => ({ username: 'a', password: 'b' }),
        },
    });
});

test('a bearer provider may not return a non-string', () => {
    createClient(contract, {
        baseUrl: 'http://localhost',
        auth: {
            // @ts-expect-error bearer providers must return a string token
            user: () => 123,
            admin: () => ({ username: 'a', password: 'b' }),
        },
    });
});

test('a basic provider yields username/password', () => {
    createClient(contract, {
        baseUrl: 'http://localhost',
        auth: {
            user: () => 'token',
            // @ts-expect-error basic providers must return { username, password }, not a string
            admin: () => 'token',
        },
    });
});

test('async providers are accepted', () => {
    createClient(contract, {
        baseUrl: 'http://localhost',
        auth: {
            user: async () => 'token',
            admin: async () => ({ username: 'a', password: 'b' }),
        },
    });
});

test('a provider may return null', () => {
    createClient(contract, {
        baseUrl: 'http://localhost',
        auth: {
            user: () => null,
            admin: () => null,
        },
    });
});

test('a subset of providers is accepted', () => {
    createClient(contract, {
        baseUrl: 'http://localhost',
        auth: {
            user: () => 'token',
        },
    });
});

test('auth may be omitted', () => {
    createClient(contract, {
        baseUrl: 'http://localhost',
    });
});

test('custom identities are not client-placeable and cannot be given a provider', () => {
    createClient(contract, {
        baseUrl: 'http://localhost',
        auth: {
            user: () => 'token',
            admin: () => ({ username: 'a', password: 'b' }),
            // @ts-expect-error `inviteToken` is a custom identity with no client-placeable credential
            inviteToken: () => 'token',
        },
    });
});
