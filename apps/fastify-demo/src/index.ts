import Fastify from 'fastify';
import { createMcpEndpoint } from '@ts-kizuna/mcp/fastify';
import fastifyApiReference from '@scalar/fastify-api-reference';

import { api } from './lib/api';
import { openApiSpec } from './lib/openApi';

const app = Fastify();

app.get('/openapi.json', async (_request, reply) => {
    reply.send(openApiSpec('json'));
});

app.get('/openapi.yaml', async (_request, reply) => {
    reply.header('content-type', 'text/yaml; charset=utf-8').send(openApiSpec('yaml'));
});

app.register(fastifyApiReference, {
    routePrefix: '/docs',
    configuration: {
        url: '/openapi.json',
    },
});

app.get('/', async (_request, reply) => {
    reply.header('content-type', 'text/html; charset=utf-8').send(`<!doctype html>
<html lang="en">
    <head>
        <meta charset="utf-8" />
        <title>ts-kizuna Fastify demo</title>
        <style>
            body { font-family: system-ui; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
            h1 { margin-bottom: 0.25rem; }
            ul { padding-left: 1.25rem; }
            code { background: #f4f4f4; padding: 0.1rem 0.35rem; border-radius: 0.25rem; }
        </style>
    </head>
    <body>
        <h1>ts-kizuna Fastify demo</h1>
        <p>This demo shares the same routes from <code>@ts-kizuna-demo/shared</code>.</p>
        <ul>
            <li><a href="http://localhost:8002/users">Fastify API</a> — <code>:8002/users</code></li>
            <li><a href="http://localhost:8002/docs">Fastify API docs (Scalar)</a> — <code>:8002/docs</code></li>
            <li><a href="http://localhost:8002/openapi.json">OpenAPI spec (JSON)</a> — <code>:8002/openapi.json</code></li>
            <li><a href="http://localhost:8002/openapi.yaml">OpenAPI spec (YAML)</a> — <code>:8002/openapi.yaml</code></li>
        </ul>
    </body>
</html>`);
});

await api.mount(app);
await createMcpEndpoint(api, app);

const port = Number(process.env.PORT ?? 8002);
app.listen(
    {
        port,
    },
    () => {
        console.log(`ts-kizuna fastify demo on http://localhost:${port}`);
    }
);
