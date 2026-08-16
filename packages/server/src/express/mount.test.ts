import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { KizunaServer } from './server.js';
import { userContract, createUserRouter } from '../adapter-testing/fixtures.js';

describe('api.mount', () => {
    it('serves routes', async () => {
        const server = new KizunaServer(userContract);
        const api = server.api({ router: createUserRouter() as never });
        const app = express();
        app.use(express.json());
        api.mount(app);
        await request(app).post('/users').send({ name: 'Ada', email: 'ada@example.com' });
        expect((await request(app).get('/users/1')).status).toBe(200);
    });
});
