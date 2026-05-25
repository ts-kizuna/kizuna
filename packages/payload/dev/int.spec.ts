import type { Payload, SanitizedConfig } from 'payload';
import { getPayload, handleEndpoints } from 'payload';

import config from './payload.config.js';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

let payload: Payload;
let sanitizedConfig: SanitizedConfig;

afterAll(async () => {
    await payload.destroy();
});

beforeAll(async () => {
    payload = await getPayload({
        config: await config,
    });
    sanitizedConfig = payload.config;
});

async function request(method: string, path: string, options?: { body?: unknown; headers?: Record<string, string> }): Promise<Response> {
    const url = `http://localhost/api${path}`;
    const headers = new Headers({
        accept: 'application/json',
        ...options?.headers,
    });

    const request = new Request(url, {
        method,
        headers,
        body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    return handleEndpoints({
        config: sanitizedConfig,
        request,
    });
}

describe('Payload kizunaPlugin integration', () => {
    test('creates an item via POST', async () => {
        const response = await request('POST', '/items', {
            body: {
                name: 'Widget',
            },
            headers: {
                'content-type': 'application/json',
            },
        });
        expect(response.status).toBe(201);
        const body = await response.json();
        expect(body.name).toBe('Widget');
        expect(body.id).toBeDefined();
    });

    test('gets an item by id', async () => {
        const created = await request('POST', '/items', {
            body: {
                name: 'Gadget',
            },
            headers: {
                'content-type': 'application/json',
            },
        });
        const createdBody = await created.json();

        const response = await request('GET', `/items/${createdBody.id}`);
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.name).toBe('Gadget');
    });

    test('returns 404 for missing item', async () => {
        const response = await request('GET', '/items/nonexistent');
        expect(response.status).toBe(404);
        const body = await response.json();
        expect(body.message).toBe('Not found');
    });

    test('lists items', async () => {
        const response = await request('GET', '/items');
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(Array.isArray(body.items)).toBe(true);
    });

    test('returns 400 for invalid body', async () => {
        const response = await request('POST', '/items', {
            body: {
                name: '',
            },
            headers: {
                'content-type': 'application/json',
            },
        });
        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.message).toBe('Invalid request body');
    });

    test('returns 415 for wrong content type', async () => {
        const response = await request('POST', '/items', {
            body: '<item><name>Foo</name></item>',
            headers: {
                'content-type': 'application/xml',
            },
        });
        expect(response.status).toBe(415);
    });

    test('guard blocks unauthenticated access to protected route', async () => {
        const response = await request('GET', '/protected');
        expect(response.status).toBe(401);
        const body = await response.json();
        expect(body.message).toBe('Unauthorized');
    });
});
