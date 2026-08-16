import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { KizunaServer } from '../next/server.js';
import { userContract, createUserRouter } from '../adapter-testing/fixtures.js';

describe('api.mount', () => {
    it('serves routes', async () => {
        const server = new KizunaServer(userContract);
        const api = server.api({ router: createUserRouter() as never });
        const app = new Hono();
        api.mount(app);
        await app.request('/users', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Ada', email: 'ada@example.com' }),
        });
        expect((await app.request('/users/1')).status).toBe(200);
    });
});
