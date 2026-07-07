# ts-kizuna

![ts-kizuna](docs/public/readme-beta.png)

Build fully typed REST APIs with TypeScript — contract-first, RFC-correct, powered by Zod.

![npm](https://img.shields.io/badge/npm-v1.23.0-blue)
![license](https://img.shields.io/badge/license-MIT-blue)

[Documentation](https://ts-kizuna.com)

> [!NOTE]
> **Why is it already 1.0 if it's in beta?** We built ts-kizuna for our own apps and have been battle-testing it in production since before we open-sourced it. It's labeled beta because the syntax for how you write contracts, routers, and clients may still change before v2.
>
> We recommend pinning your version, then upgrading whenever it suits you.
>
> [See the release notes](https://github.com/ts-kizuna/kizuna/releases)

## Features

- **Contract-first** — define request/response schemas once, share between server and client
- **Type-safe everywhere** — full inference on both sides, no casting
- **Typed auth** — identities and per-route auth declared on the contract
- **RPC-like client** — call your API like a function, get fully typed responses back
- **Adapters** — mount your API on Express, Fastify, Hono, or Next.js
- **HTTP/REST** — follows HTTP and REST standards. RFC 9110 semantics, RFC 9457 Problem Details
- **Built-in coercion** — query, path, and header params are coerced to their declared types (`z.number()`, `z.boolean()`, `z.date()`, `z.bigint()`) — no manual parsing or `z.coerce` needed
- **OpenAPI generation** — from the same contract, no annotations needed
- **Native client generation** — typed API clients for Swift (iOS/macOS) and Kotlin (Android/JVM)
- **MCP server generation** — expose your API as MCP tools so AI assistants can call your endpoints
- **Deprecation support** — mark endpoints and fields as deprecated with a JSDoc `@deprecated` tag — IDEs show strikethroughs, OpenAPI, Swift, and Kotlin pick it up automatically

## Define your API routes

Define each route: pick a method and path, then describe what it takes in and sends back with Zod.

```ts
// routes.ts
const UserSchema = createModel({
    title: 'User',
    schema: z.object({
        id: z.string(),
        name: z.string(),
    }),
});

export const users = k.routes('users', {
    getUser: {
        method: 'GET',
        path: '/users/:id',
        responses: {
            200: UserSchema,
            404: ProblemDetailsSchema,
        },
    },
    createUser: {
        method: 'POST',
        path: '/users',
        body: z.object({
            name: z.string(),
        }),
        responses: {
            201: UserSchema,
        },
    },
});
```

## Bundle into a contract

The contract is the single object you hand to the client and the server adapters.

```ts
// contract.ts
export const contract = k.contract({
    routes: {
        users,
    },
});
```

## Implement your routes on the server

```ts
// router.ts
export const router = createRouter(contract, {
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
        createUser: async ({ body }) => {
            const user = await db.users.create({
                name: body.name,
            });
            return {
                status: 201,
                body: user,
            };
        },
    },
});
```

## Bind the contract to your server

`createApi` joins the contract with your router:

```ts
// server.ts
export const api = createApi({
    contract,
    router,
});
```

Then mount it on your app:

```ts
// index.ts
const app = express();
app.use(express.json());

createExpressEndpoints(api, app);
app.listen(3000);
```

## Use the API on the client

```ts
// client.ts
const client = createClient(contract, {
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

## Packages

| Package                    | Description                                           |
| -------------------------- | ----------------------------------------------------- |
| `@ts-kizuna/core`          | Routes & contract definition, validation, adapter API |
| `@ts-kizuna/fetch`         | Typed fetch-based client                              |
| `@ts-kizuna/express`       | Express adapter                                       |
| `@ts-kizuna/fastify`       | Fastify adapter                                       |
| `@ts-kizuna/hono`          | Hono adapter                                          |
| `@ts-kizuna/next`          | Next.js App Router adapter                            |
| `@ts-kizuna/openapi`       | OpenAPI generation                                    |
| `@ts-kizuna/swift`         | Swift client generation                               |
| `@ts-kizuna/kotlin`        | Kotlin client generation                              |
| `@ts-kizuna/mcp`           | MCP server generation                                 |
| `@ts-kizuna/eslint-plugin` | ESLint rules                                          |
| `@ts-kizuna/cli`           | Shared CLI and build tooling                          |

## License

MIT
