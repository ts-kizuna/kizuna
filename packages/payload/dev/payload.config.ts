import path from 'path';
import { fileURLToPath } from 'url';
import { buildConfig } from 'payload';
import { sqliteAdapter } from '@payloadcms/db-sqlite';
import { createContract, ErrorResponse } from '@ts-kizuna/core';
import { z } from 'zod';
import { createApi, createRouter, createMiddleware, createGuard, kizunaPlugin } from '../src/server.js';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

const contract = createContract({
    getItem: {
        method: 'GET',
        path: '/items/:id',
        responses: {
            200: z.object({
                id: z.string(),
                name: z.string(),
            }),
            404: ErrorResponse,
        },
    },
    createItem: {
        method: 'POST',
        path: '/items',
        body: z.object({
            name: z.string().min(1),
        }),
        responses: {
            201: z.object({
                id: z.string(),
                name: z.string(),
            }),
        },
    },
    listItems: {
        method: 'GET',
        path: '/items',
        query: z.object({
            page: z.coerce.number().int().min(1).default(1),
        }),
        responses: {
            200: z.object({
                items: z.array(
                    z.object({
                        id: z.string(),
                        name: z.string(),
                    })
                ),
            }),
        },
    },
    protectedRoute: {
        method: 'GET',
        path: '/protected',
        responses: {
            200: z.object({
                message: z.string(),
            }),
        },
    },
});

const items = new Map<string, { id: string; name: string }>();
let nextId = 1;

const requireAuth = createGuard(async (req, deny) => {
    if (!req.user) {
        return deny(401, 'Unauthorized');
    }
});

const router = createRouter(contract, {
    getItem: ({ params }) => {
        const item = items.get(params.id);
        if (!item) {
            return {
                status: 404,
                body: {
                    message: 'Not found',
                },
            };
        }
        return {
            status: 200,
            body: item,
        };
    },
    createItem: ({ body }) => {
        const id = String(nextId++);
        const item = {
            id,
            name: body.name,
        };
        items.set(id, item);
        return {
            status: 201,
            body: item,
        };
    },
    listItems: () => ({
        status: 200,
        body: {
            items: Array.from(items.values()),
        },
    }),
    protectedRoute: () => ({
        status: 200,
        body: {
            message: 'secret',
        },
    }),
});

const middleware = createMiddleware(contract, {
    getItem: [],
    createItem: [],
    listItems: [],
    protectedRoute: [requireAuth],
});

const api = createApi({
    contract,
    router,
    middleware,
});

export default buildConfig({
    secret: 'test-secret-key-for-integration-tests',
    db: sqliteAdapter({
        client: {
            url: 'file:./dev/test.db',
        },
    }),
    collections: [
        {
            slug: 'users',
            auth: true,
            fields: [],
        },
    ],
    plugins: [kizunaPlugin(api)],
    typescript: {
        outputFile: path.resolve(dirname, 'payload-types.ts'),
    },
});
