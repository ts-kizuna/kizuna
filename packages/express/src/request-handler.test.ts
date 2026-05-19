import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { createContract } from '@ts-kizuna/core';
import { createApi, createExpressEndpoints } from './server.js';

const contract = createContract({
    createUser: {
        method: 'POST',
        path: '/users',
        body: z.object({
            name: z.string().min(1),
            email: z.email(),
            age: z.number().int().positive().optional(),
        }),
        responses: {
            201: z.object({
                id: z.string(),
            }),
            400: z.object({
                message: z.string(),
            }),
        },
    },
});

const createTestApp = () => {
    const app = express();
    app.use(express.json());

    const api = createApi({
        contract,
        router: {
            createUser: () => ({
                status: 201,
                body: {
                    id: '1',
                },
            }),
        },
    });

    createExpressEndpoints(api, app);
    return app;
};

describe('Zod validation', () => {
    const app = createTestApp();

    it('returns 400 for missing required fields', async () => {
        const response = await request(app).post('/users').send({});
        expect(response.status).toBe(400);
    });

    it('returns 400 for invalid email', async () => {
        const response = await request(app).post('/users').send({
            name: 'Alice',
            email: 'not-an-email',
        });
        expect(response.status).toBe(400);
    });

    it('returns 400 for empty name', async () => {
        const response = await request(app).post('/users').send({
            name: '',
            email: 'alice@test.com',
        });
        expect(response.status).toBe(400);
    });

    it('returns 400 for wrong-type optional field', async () => {
        const response = await request(app).post('/users').send({
            name: 'Alice',
            email: 'alice@test.com',
            age: 'not-a-number',
        });
        expect(response.status).toBe(400);
    });

    it('includes structured Zod issues on 400', async () => {
        const response = await request(app).post('/users').send({
            name: 'Alice',
            email: 'bad',
        });
        expect(response.status).toBe(400);
        expect(response.body.title).toBe('Validation Failed');
        expect(response.body.status).toBe(400);
        expect(Array.isArray(response.body.issues)).toBe(true);
    });

    it('accepts a request with only required fields', async () => {
        const response = await request(app).post('/users').send({
            name: 'Alice',
            email: 'alice@test.com',
        });
        expect(response.status).toBe(201);
    });

    it('accepts valid optional fields', async () => {
        const response = await request(app).post('/users').send({
            name: 'Alice',
            email: 'alice@test.com',
            age: 25,
        });
        expect(response.status).toBe(201);
    });
});
