import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { apiReference } from '@scalar/hono-api-reference';
import { createMcpEndpoint } from '@ts-kizuna/mcp/hono';

import { api } from './lib/api';
import { openApiSpec } from './lib/openApi';

const app = new Hono();

app.get('/openapi.json', (c) => {
    return c.json(openApiSpec('json'));
});

app.get('/openapi.yaml', (c) => {
    return c.text(openApiSpec('yaml') as string, 200, {
        'content-type': 'text/yaml; charset=utf-8',
    });
});

app.get(
    '/docs',
    apiReference({
        url: '/openapi.json',
    })
);

app.get('/', (c) => {
    return c.html(`<!doctype html>
<html lang="en">
    <head>
        <meta charset="utf-8" />
        <title>ts-kizuna Hono demo</title>
        <style>
            body { font-family: system-ui; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
            h1 { margin-bottom: 0.25rem; }
            ul { padding-left: 1.25rem; }
            code { background: #f4f4f4; padding: 0.1rem 0.35rem; border-radius: 0.25rem; }
        </style>
    </head>
    <body>
        <h1>ts-kizuna Hono demo</h1>
        <p>This demo shares the same routes from <code>@ts-kizuna-demo/shared</code>.</p>
        <ul>
            <li><a href="http://localhost:8001/users">Hono API</a> — <code>:8001/users</code></li>
            <li><a href="http://localhost:8001/docs">Hono API docs (Scalar)</a> — <code>:8001/docs</code></li>
            <li><a href="http://localhost:8001/openapi.json">OpenAPI spec (JSON)</a> — <code>:8001/openapi.json</code></li>
            <li><a href="http://localhost:8001/openapi.yaml">OpenAPI spec (YAML)</a> — <code>:8001/openapi.yaml</code></li>
        </ul>
    </body>
</html>`);
});

api.mount(app);
createMcpEndpoint(api, app);

const port = Number(process.env.PORT ?? 8001);
serve(
    {
        fetch: app.fetch,
        port,
    },
    () => {
        console.log(`ts-kizuna hono demo on http://localhost:${port}`);
    }
);
