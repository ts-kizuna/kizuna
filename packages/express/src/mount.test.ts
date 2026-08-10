import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { KizunaApi } from './server.js';
import { userContract, createUserRouter } from '../../core/src/adapter-testing/fixtures.js';

describe('api.mount', () => {
    it('serves routes', async () => {
        const api = new KizunaApi({
            contract: userContract,
            router: createUserRouter() as never,
        });
        const app = express();
        app.use(express.json());
        api.mount(app);
        await request(app).post('/users').send({ name: 'Ada', email: 'ada@example.com' });
        expect((await request(app).get('/users/1')).status).toBe(200);
    });
});
