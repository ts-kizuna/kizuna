import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Kizuna } from '@ts-kizuna/core';
import { FileSchema } from '@ts-kizuna/core/schemas';
import { KizunaServer } from './server.js';

const k = new Kizuna({
    tags: Kizuna.tags({
        files: 'Files',
    }),
});

const contract = k.contract({
    routes: k.routes('files', {
        upload: {
            method: 'POST',
            path: '/upload',
            contentType: 'multipart/form-data',
            body: z.object({
                file: FileSchema,
                label: z.string(),
            }),
            responses: {
                200: z.object({
                    size: z.number(),
                    label: z.string(),
                }),
            },
        },
    }),
});

describe('fastify multipart parsing', () => {
    it('parses a multipart body without a user-registered parser', async () => {
        const api = new KizunaServer(contract).api({
            router: {
                upload: async ({ body }) => ({
                    status: 200,
                    body: {
                        size: body.file.size,
                        label: body.label,
                    },
                }),
            },
        });
        const app = Fastify();
        await api.mount(app);
        const form = new FormData();
        form.append('file', new File(['hello world'], 'hello.txt', { type: 'text/plain' }));
        form.append('label', 'greeting');
        const encoded = new Response(form);
        const response = await app.inject({
            method: 'POST',
            url: '/upload',
            headers: {
                'content-type': encoded.headers.get('content-type') ?? '',
            },
            payload: Buffer.from(await encoded.arrayBuffer()),
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({
            size: 11,
            label: 'greeting',
        });
    });
});
