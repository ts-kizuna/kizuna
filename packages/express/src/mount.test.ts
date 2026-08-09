import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { KizunaServer } from './server.js';
import { userContract, createUserRouter } from '../../core/src/adapter-testing/fixtures.js';

describe('api.mount', () => {
    it('serves routes', async () => {
        const { server } = KizunaServer.init(userContract);
        const api = server.api({ router: createUserRouter() as never });
        const app = express();
        app.use(express.json());
        api.mount(app);
        await request(app).post('/users').send({ name: 'Ada', email: 'ada@example.com' });
        expect((await request(app).get('/users/1')).status).toBe(200);
    });

    it('api.mount runs registered plugins', async () => {
        const seen: string[] = [];
        const { server } = KizunaServer.init(userContract);
        const api = server.api({
            router: createUserRouter() as never,
            plugins: [
                {
                    name: 'probe',
                    mount: (app) => {
                        seen.push(app === undefined ? 'no-app' : 'got-app');
                    },
                },
            ],
        });
        const app = express();
        app.use(express.json());
        api.mount(app);
        await request(app).post('/users').send({ name: 'Ada', email: 'ada@example.com' });
        expect((await request(app).get('/users/1')).status).toBe(200);
        expect(seen).toEqual(['got-app']);
    });
});
