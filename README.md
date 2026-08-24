# ts-kizuna

![ts-kizuna](https://raw.githubusercontent.com/ts-kizuna/kizuna/main/docs/public/readme-beta.png)

Build fully typed REST APIs with TypeScript. Write one contract. Get a fully typed server, an OpenAPI spec, Swift and Kotlin clients, and more.

[![npm](https://img.shields.io/npm/v/@ts-kizuna/core?color=blue&label=npm)](https://www.npmjs.com/package/@ts-kizuna/core)
![license](https://img.shields.io/badge/license-MIT-blue)

[Documentation](https://ts-kizuna.com)

> [!NOTE]
> **Why is it already 1.0 if it's in beta?** We built ts-kizuna for our own apps and have been battle-testing it in production since before we open-sourced it. The version number came with it from that internal history, so read it as 0.x. It's labeled beta because the syntax for how you write contracts, routers, and clients may still change before v2.
>
> So a minor version can carry a breaking change while ts-kizuna is in beta. Every release names them under **⚠ BREAKING CHANGES**, so pin your version and upgrade when it suits you.
>
> [See the release notes](https://github.com/ts-kizuna/kizuna/releases)

## Features

- **Contract-first**: define request/response schemas once, share between server and client
- **Type-safe everywhere**: full inference on both sides, no casting
- **Typed authentication**: identities and per-route authentication declared on the contract
- **RPC-like client**: call your API like a function, get fully typed responses back
- **TanStack Query**: typed query and mutation options with caching and invalidation
- **Adapters**: mount your API on Express, Fastify, Hono, or Next.js
- **HTTP/REST**: follows HTTP and REST standards. RFC 9110 semantics, RFC 9457 Problem Details
- **Built-in coercion**: query, path, and header params are coerced to their declared types (`z.number()`, `z.boolean()`, `z.date()`, `z.bigint()`), with no manual parsing or `z.coerce` needed
- **OpenAPI generation**: from the same contract, no annotations needed
- **Native client generation**: typed API clients for Swift (iOS/macOS) and Kotlin (Android/JVM)
- **Plugins**: extend your API with features built on the contract you already wrote, and get them fully typed in your handlers
- **MCP server generation**: expose your API as MCP tools so AI assistants can call your endpoints
- **Scheduled jobs**: declare cron work next to its handler, tick it from any platform scheduler, or run it in process from a route handler
- **Deprecation and sunset support**: deprecate routes and fields, and it shows up in your editor, OpenAPI, Swift, Kotlin, and the response headers

## Getting started

### Define your API routes

Export a `k` instance once. It takes optional tags, identities, request contexts, and validation settings.

```ts
// k.ts
import { Kizuna } from '@ts-kizuna/core';

export const k = new Kizuna();
```

Then define each route: pick a method and path, then describe what it takes in and sends back with Zod.

```ts
// routes.ts
import { z } from 'zod';
import { ProblemDetailsSchema } from '@ts-kizuna/core/schemas';
import { k } from './k';

export const users = k.routes({
    getUser: {
        method: 'GET',
        path: '/users/:id',
        responses: {
            200: z.object({
                id: z.string(),
                name: z.string(),
            }),
            404: ProblemDetailsSchema,
        },
    },
});
```

### Bundle into a contract

The contract is the single object you hand to the server and the client.

```ts
// contract.ts
import { k } from './k';
import { users } from './routes';

export const contract = k.contract({
    routes: {
        users,
    },
});
```

### Implement your routes on the server

Handlers get validated, typed input, and their return values are checked against the responses the contract declares.

```ts
// server.ts
import { KizunaServer } from '@ts-kizuna/express'; // or any other adapter
import { contract } from './contract';

export const server = new KizunaServer(contract);
```

```ts
// router.ts
import { server } from './server';

export const router = server.router({
    users: {
        getUser: async ({ params }) => {
            const user = await db.users.findById(params.id);
            if (!user) {
                return {
                    status: 404,
                    body: {
                        detail: 'Not found',
                    },
                };
            }
            return {
                status: 200,
                body: user,
            };
        },
    },
});
```

### Mount it on your app

`api.ts` is where the router, guards, jobs, and plugins come together, and what the adapter mounts.

```ts
// api.ts
import { server } from './server';
import { router } from './router';

export const api = server.api({
    router,
});
```

```ts
// index.ts
import express from 'express';
import { api } from './api';

const app = express();
app.use(express.json());

api.mount(app);
app.listen(3000);
```

### Use the API on the client

Every route, input, and response comes from the same contract, so the client already knows them.

```ts
// client.ts
import { KizunaClient } from '@ts-kizuna/fetch';
import { contract } from './contract';

const client = new KizunaClient(contract, {
    baseUrl: 'http://localhost:3000',
});

const result = await client.users.getUser({
    params: {
        id: '1',
    },
});

if (result.status === 200) {
    result.body; // { id: string; name: string }
}
```

[Read the full docs](https://ts-kizuna.com/docs)

## Packages

| Package                     | Description                                           |
| --------------------------- | ----------------------------------------------------- |
| `@ts-kizuna/core`           | Routes & contract definition, validation, adapter API |
| `@ts-kizuna/fetch`          | Typed fetch-based client                              |
| `@ts-kizuna/tanstack-query` | TanStack Query client                                 |
| `@ts-kizuna/express`        | Express adapter                                       |
| `@ts-kizuna/fastify`        | Fastify adapter                                       |
| `@ts-kizuna/hono`           | Hono adapter                                          |
| `@ts-kizuna/next`           | Next.js App Router adapter                            |
| `@ts-kizuna/openapi`        | OpenAPI generation                                    |
| `@ts-kizuna/swift`          | Swift client generation                               |
| `@ts-kizuna/kotlin`         | Kotlin client generation                              |
| `@ts-kizuna/mcp`            | MCP server generation                                 |
| `@ts-kizuna/eslint-plugin`  | ESLint rules                                          |
| `@ts-kizuna/cli`            | Shared CLI and build tooling                          |

## License

MIT
