# @ts-kizuna/fetch

`@ts-kizuna/fetch` provides `new KizunaClient()`, a typed wrapper around the native `fetch` API. It runs anywhere `fetch` does, React Native included.

## Installation

```sh
pnpm add @ts-kizuna/fetch
```

## Usage

```ts
import { KizunaClient } from '@ts-kizuna/fetch';
import { contract } from './contract';

const apiClient = new KizunaClient(contract, {
    baseUrl: 'http://localhost:3000',
});

const { status, body } = await apiClient.users.getUser({
    params: {
        id: '1',
    },
});
```

## Documentation

[Fetch client](https://ts-kizuna.com/docs/clients/fetch)
