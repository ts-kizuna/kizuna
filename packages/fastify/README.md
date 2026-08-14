# @ts-kizuna/fastify

`@ts-kizuna/fastify` connects a ts-kizuna API to a Fastify application.

**Requires Fastify >= 5.**

## Installation

```sh
pnpm add @ts-kizuna/fastify fastify
```

## Usage

```ts
import Fastify from 'fastify';
import { KizunaServer } from '@ts-kizuna/fastify';
import { contract } from './contract';
import { router } from './router';

const server = new KizunaServer(contract);

const api = server.api({
    router,
});

const app = Fastify();
await api.mount(app);

app.listen({
    port: 3000,
});
```

## Documentation

[Fastify adapter](https://ts-kizuna.com/docs/adapters/fastify)
