import express from 'express';
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

describe('express multipart parsing', () => {
    it('parses a multipart body without middleware', async () => {
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
        const app = express();
        api.mount(app);
        const listening = app.listen(0);
        const address = listening.address();
        const port = typeof address === 'object' && address !== null ? address.port : 0;
        try {
            const form = new FormData();
            form.append('file', new File(['hello world'], 'hello.txt', { type: 'text/plain' }));
            form.append('label', 'greeting');
            const response = await fetch(`http://127.0.0.1:${port}/upload`, {
                method: 'POST',
                body: form,
            });
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({
                size: 11,
                label: 'greeting',
            });
        } finally {
            listening.close();
        }
    });
});
