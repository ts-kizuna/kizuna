import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { createApi, createExpressEndpoints, createServer } from './server.js';
import { readTestBody, sessionAuthorization, testAdapterFeatures } from '../../core/src/adapter-testing/index.js';

const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    if (req.headers.authorization !== sessionAuthorization) {
        res.status(401).json({
            detail: 'Unauthorized',
        });
        return;
    }
    next();
};

testAdapterFeatures({
    name: 'express',
    createApi,
    createServerApi: (contract, options) => createServer(contract).server.api(options),
    requireAuth,
    mount: (api, { responseValidation }) => {
        const app = express();
        app.use(express.json());
        createExpressEndpoints(api, app, {
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
