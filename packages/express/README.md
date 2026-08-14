# @ts-kizuna/express

`@ts-kizuna/express` connects a ts-kizuna API to an Express 5 application. It handles routing, request validation, body parsing, and error formatting, all driven by your contract.

**Requires Express >= 5.**

## Installation

```sh
pnpm add @ts-kizuna/express express
```

## Usage

```ts
import express from 'express';
import { KizunaServer } from '@ts-kizuna/express';
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

## Documentation

[Express adapter](https://ts-kizuna.com/docs/adapters/express)
