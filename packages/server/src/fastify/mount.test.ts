import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { KizunaServer } from '../next/server.js';
import { userContract, createUserRouter } from '../adapter-testing/fixtures.js';

describe('api.mount and api.plugin', () => {
    it('mount(app) serves routes', async () => {
        const server = new KizunaServer(userContract);
        const api = server.api({ router: createUserRouter() as never });
        const app = Fastify();
        await api.mount(app);
        await app.inject({ method: 'POST', url: '/users', payload: { name: 'Ada', email: 'ada@example.com' } });
        expect((await app.inject({ method: 'GET', url: '/users/1' })).statusCode).toBe(200);
    });

    it('app.register(api.plugin) serves routes', async () => {
        const server = new KizunaServer(userContract);
        const api = server.api({ router: createUserRouter() as never });
        const app = Fastify();
        await app.register(api.plugin, {});
        await app.inject({ method: 'POST', url: '/users', payload: { name: 'Ada', email: 'ada@example.com' } });
        expect((await app.inject({ method: 'GET', url: '/users/1' })).statusCode).toBe(200);
    });
});
