# ts-kizuna

![ts-kizuna](docs/public/readme.png)

Build fully typed REST APIs with TypeScript — contract-first, RFC-correct, powered by Zod 4.

[Documentation](https://ts-kizuna.com)

## Features

- **Contract-first** — define request/response schemas once, share between server and client
- **Type-safe everywhere** — full inference on both sides, no casting
- **RPC-like client** — call your API like a function, get fully typed responses back
- **HTTP/REST** — follows HTTP and REST standards. RFC 9110 semantics, RFC 9457 Problem Details
- **OpenAPI 3.1.0 generation** — from the same contract, no annotations needed
- **Swift client generation** — typed API client for iOS/macOS
- **MCP server generation** — expose your API as MCP tools so AI assistants can call your endpoints
- **Deprecation support** — mark endpoints and fields as deprecated with a JSDoc `@deprecated` tag — IDEs show strikethroughs, OpenAPI and Swift pick it up automatically

## Define your API contract

The contract is a plain TypeScript object. It lives in a shared package that both your server and client import.

```ts
import { createContract } from '@ts-kizuna/core';
import { z } from 'zod';

export const contract = createContract({
    getUser: {
        method: 'GET',
        path: '/users/:id',
        responses: {
            200: z.object({
                id: z.string(),
                name: z.string(),
            }),
            404: z.object({
                message: z.string(),
            }),
        },
    },
    createUser: {
        method: 'POST',
        path: '/users',
        body: z.object({
            name: z.string(),
        }),
        responses: {
            201: z.object({
                id: z.string(),
                name: z.string(),
            }),
        },
    },
});
```

## Fulfill the contract on your server

```ts
import { createRouter } from '@ts-kizuna/express'; // or @ts-kizuna/hono, @ts-kizuna/next
import { contract } from '@shared/contract';

export const router = createRouter(contract, {
    getUser: async ({ params }) => {
        const user = await db.users.findById(params.id);
        if (!user) {
            return {
                status: 404,
                body: {
                    message: 'Not found',
                },
            };
        }
        return {
            status: 200,
            body: user,
        };
    },
    createUser: async ({ body }) => {
        const user = await db.users.create({
            name: body.name,
        });
        return {
            status: 201,
            body: user,
        };
    },
});
```

## Use the API on the client

```ts
import { createClient } from '@ts-kizuna/fetch';
import { contract } from '@shared/contract';

const client = createClient(contract, {
    baseUrl: 'http://localhost:3000',
});

const result = await client.getUser({
    params: {
        id: '1',
    },
});

if (result.status === 200) {
    result.body; // { id: string; name: string }
}
```

## Packages

| Package               | Description                                  |
| --------------------- | -------------------------------------------- |
| `@ts-kizuna/core`     | Contract definition, validation, adapter API |
| `@ts-kizuna/fetch`    | Typed fetch-based client                     |
| `@ts-kizuna/express`  | Express adapter                              |
| `@ts-kizuna/hono`     | Hono adapter                                 |
| `@ts-kizuna/next`     | Next.js App Router adapter                   |
| `@ts-kizuna/open-api` | OpenAPI 3.1.0 spec generation                |
| `@ts-kizuna/swift`    | Swift client generation                      |
| `@ts-kizuna/mcp`      | MCP server generation                        |

## License

MIT
