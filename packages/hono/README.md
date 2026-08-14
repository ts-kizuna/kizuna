# @ts-kizuna/hono

`@ts-kizuna/hono` connects a ts-kizuna API to a Hono application. Hono runs on Cloudflare Workers, Deno, Bun, Node.js, and other runtimes.

**Requires Hono >= 4.**

## Installation

```sh
pnpm add @ts-kizuna/hono hono
```

## Usage

```ts
import { Hono } from 'hono';
import { KizunaServer } from '@ts-kizuna/hono';
import { contract } from './contract';
import { router } from './router';

const server = new KizunaServer(contract);

const api = server.api({
    router,
});

const app = new Hono();
api.mount(app);

export default app;
```

## Documentation

[Hono adapter](https://ts-kizuna.com/docs/adapters/hono)
