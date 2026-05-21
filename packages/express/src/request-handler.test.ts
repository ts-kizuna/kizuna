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
        expect(response.body.message).toBe('Invalid request body');
        expect(Array.isArray(response.body.issues)).toBe(true);
        const issue = response.body.issues[0];
        expect(typeof issue.code).toBe('string');
        expect(Array.isArray(issue.path)).toBe(true);
        expect(typeof issue.message).toBe('string');
        expect(Object.keys(issue)).toEqual(['code', 'path', 'message']);
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

describe('validation issue codes', () => {
    const refinedContract = createContract({
        register: {
            method: 'POST',
            path: '/register',
            body: z
                .object({
                    phone: z
                        .string()
                        .min(8)
                        .refine((value) => value.startsWith('+'), 'Phone must include country code'),
                    age: z.number().int().min(18).max(120),
                    tags: z.array(z.string()).max(3),
                })
                .refine((data) => !(data.phone.startsWith('+000') && data.age < 21), 'Suspicious registration'),
            responses: {
                201: z.object({
                    id: z.string(),
                }),
            },
        },
    });

    const refinedApp = express();
    refinedApp.use(express.json());
    const refinedApi = createApi({
        contract: refinedContract,
        router: {
            register: () => ({
                status: 201,
                body: {
                    id: '1',
                },
            }),
        },
    });
    createExpressEndpoints(refinedApi, refinedApp);

    it('returns invalid_type when a required field is missing', async () => {
        const response = await request(refinedApp).post('/register').send({});
        expect(response.status).toBe(400);
        const phoneIssue = response.body.issues.find((issue: { path: string[] }) => issue.path[0] === 'phone');
        expect(phoneIssue.code).toBe('invalid_type');
    });

    it('returns too_small when a string is below minLength', async () => {
        const response = await request(refinedApp).post('/register').send({
            phone: '+1',
            age: 25,
            tags: [],
        });
        expect(response.status).toBe(400);
        const phoneIssue = response.body.issues.find((issue: { path: string[] }) => issue.path[0] === 'phone');
        expect(phoneIssue.code).toBe('too_small');
    });

    it('returns too_big when a number exceeds max', async () => {
        const response = await request(refinedApp).post('/register').send({
            phone: '+12345678',
            age: 999,
            tags: [],
        });
        expect(response.status).toBe(400);
        const ageIssue = response.body.issues.find((issue: { path: string[] }) => issue.path[0] === 'age');
        expect(ageIssue.code).toBe('too_big');
    });

    it('returns custom for .refine() failures on a field', async () => {
        const response = await request(refinedApp).post('/register').send({
            phone: '12345678',
            age: 25,
            tags: [],
        });
        expect(response.status).toBe(400);
        const phoneIssue = response.body.issues.find((issue: { path: string[] }) => issue.path[0] === 'phone');
        expect(phoneIssue.code).toBe('custom');
        expect(phoneIssue.message).toBe('Phone must include country code');
    });

    it('returns custom for top-level .refine() failures', async () => {
        const response = await request(refinedApp).post('/register').send({
            phone: '+00000000',
            age: 20,
            tags: [],
        });
        expect(response.status).toBe(400);
        const topLevelIssue = response.body.issues.find((issue: { path: string[] }) => issue.path.length === 0);
        expect(topLevelIssue.code).toBe('custom');
        expect(topLevelIssue.message).toBe('Suspicious registration');
    });

    it('returns too_big when an array exceeds max items', async () => {
        const response = await request(refinedApp)
            .post('/register')
            .send({
                phone: '+12345678',
                age: 25,
                tags: ['a', 'b', 'c', 'd'],
            });
        expect(response.status).toBe(400);
        const tagsIssue = response.body.issues.find((issue: { path: string[] }) => issue.path[0] === 'tags');
        expect(tagsIssue.code).toBe('too_big');
    });

    it('only serializes code, path, and message on every issue', async () => {
        const response = await request(refinedApp).post('/register').send({
            phone: 123,
            age: 'not-a-number',
            tags: 'not-an-array',
        });
        expect(response.status).toBe(400);
        for (const issue of response.body.issues) {
            expect(Object.keys(issue).sort()).toEqual(['code', 'message', 'path']);
        }
    });
});
