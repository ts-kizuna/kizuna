import express from 'express';
import request from 'supertest';
import { KizunaApi } from './server.js';
import { readTestBody, testAdapterFeatures } from '../../core/src/adapter-testing/index.js';

testAdapterFeatures({
    name: 'express',
    initServerApi: (config) => new KizunaApi(config),
    mount: (api, { responseValidation }) => {
        const app = express();
        app.use(express.json());
        api.mount(app, {
            responseValidation,
        });
        return {
            request: async ({ method, path, body, headers }) => {
                let call = request(app)[method.toLowerCase() as 'get'](path).buffer(true);
                for (const [name, value] of Object.entries(headers)) call = call.set(name, value);
                const response = body === undefined ? await call : await call.send(body);
                // supertest leaves `.text` unset for non-text bodies, so fall back to the buffered body.
                const text = response.text ?? (Buffer.isBuffer(response.body) ? response.body.toString('binary') : '');
                return {
                    status: response.status,
                    headers: new Headers(response.headers as Record<string, string>),
                    body: readTestBody(text),
                    text,
                };
            },
        };
    },
});
