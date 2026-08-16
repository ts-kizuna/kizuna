# @ts-kizuna/server

`@ts-kizuna/server` serves a ts-kizuna contract. It carries the Express, Fastify, Hono, and Next.js adapters, each on its own subpath, plus the job runtime and the API for writing your own adapter.

Pick the subpath for your framework and install that framework alongside it:

## Installation

```sh
pnpm add @ts-kizuna/server express
```

## Usage

```ts
import express from 'express';
import { KizunaServer } from '@ts-kizuna/server/express';
import { contract } from './contract';
import { router } from './router';

const server = new KizunaServer(contract);

const api = server.api({
    router,
});

const app = express();
app.use(express.json());

api.mount(app);
app.listen(3000);
```

## Subpaths

| Subpath                     | Framework                             |
| --------------------------- | ------------------------------------- |
| `@ts-kizuna/server/express` | Express 5                             |
| `@ts-kizuna/server/fastify` | Fastify 5                             |
| `@ts-kizuna/server/hono`    | Hono 4                                |
| `@ts-kizuna/server/next`    | Next.js App Router, 16 and up         |
| `@ts-kizuna/server/jobs`    | Job runtime                           |
| `@ts-kizuna/server`         | `createAdapter` and `implementPlugin` |

## Documentation

[Adapters](https://ts-kizuna.com/docs/adapters)
