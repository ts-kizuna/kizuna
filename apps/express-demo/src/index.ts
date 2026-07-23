import express from 'express';
import { apiReference } from '@scalar/express-api-reference';
import { createExpressEndpoints } from '@ts-kizuna/express';
import { generateOpenApi } from '@ts-kizuna/openapi';
import { contract } from '@ts-kizuna-demo/shared';

import { server, router, requireUser, requireMember, requireInviteToken, captureAnalytics } from './lib/server';

const app = express();
app.use(express.json());

const api = server.api({
    router,
    guards: {
        user: requireUser,
        member: requireMember,
        inviteToken: requireInviteToken,
    },
    requestContext: {
        analytics: captureAnalytics,
    },
});

const openApiSpec = generateOpenApi(contract, {
    info: {
        title: 'ts-kizuna Express Demo',
        version: '1.0.0',
        description: 'Express adapter demo for the ts-kizuna user API.',
    },
    servers: [
        {
            url: 'http://localhost:8000',
            description: 'Local express demo',
        },
    ],
    setOperationId: true,
});

app.get('/openapi.json', (_req, res) => {
    res.json(openApiSpec('json'));
});

app.get('/openapi.yaml', (_req, res) => {
    res.type('text/yaml; charset=utf-8').send(openApiSpec('yaml'));
});

app.use(
    '/docs',
    apiReference({
        url: '/openapi.json',
    })
);

app.get('/', (_req, res) => {
    res.type('html').send(`<!doctype html>
<html lang="en">
    <head>
        <meta charset="utf-8" />
        <title>ts-kizuna demos</title>
        <style>
            body { font-family: system-ui; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
            h1 { margin-bottom: 0.25rem; }
            ul { padding-left: 1.25rem; }
            code { background: #f4f4f4; padding: 0.1rem 0.35rem; border-radius: 0.25rem; }
        </style>
    </head>
    <body>
        <h1>ts-kizuna demos</h1>
        <p>Both demos share the same routes from <code>@ts-kizuna-demo/shared</code>.</p>
        <ul>
            <li><a href="http://localhost:8000/users">Express API</a> — <code>:8000/users</code> (this server)</li>
            <li><a href="http://localhost:8000/docs">Express API docs (Scalar)</a> — <code>:8000/docs</code></li>
            <li><a href="http://localhost:8000/openapi.json">Express OpenAPI spec (JSON)</a> — <code>:8000/openapi.json</code></li>
            <li><a href="http://localhost:8000/openapi.yaml">Express OpenAPI spec (YAML)</a> — <code>:8000/openapi.yaml</code></li>
            <li><a href="http://localhost:8001/users">Hono API</a> — <code>:8001/users</code></li>
            <li><a href="http://localhost:8001/docs">Hono API docs (Scalar)</a> — <code>:8001/docs</code></li>
            <li><a href="http://localhost:8002/users">Fastify API</a> — <code>:8002/users</code></li>
            <li><a href="http://localhost:8002/docs">Fastify API docs (Scalar)</a> — <code>:8002/docs</code></li>
            <li><a href="http://localhost:3030/api/users">Next.js API</a> — <code>:3030/api/users</code></li>
            <li><a href="http://localhost:3030/docs">Next.js API docs (Scalar)</a> — <code>:3030/docs</code></li>
            <li><a href="http://localhost:3030/">Next.js demo page</a> — <code>:3030</code></li>
        </ul>
    </body>
</html>`);
});

createExpressEndpoints(api, app);

const port = Number(process.env.PORT ?? 8000);
app.listen(port, () => {
    console.log(`ts-kizuna express demo on http://localhost:${port}`);
});
