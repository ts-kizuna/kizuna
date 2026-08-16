# @ts-kizuna/tanstack-query

`@ts-kizuna/tanstack-query` provides `new KizunaTanstackQuery()`, which builds TanStack Query options from a ts-kizuna contract. Query keys, caching, and invalidation come from the contract you already wrote.

## Installation

```sh
pnpm add @ts-kizuna/tanstack-query
```

## Usage

```ts
import { useQuery } from '@tanstack/react-query';
import { KizunaClient } from '@ts-kizuna/fetch';
import { KizunaTanstackQuery } from '@ts-kizuna/tanstack-query';
import { contract } from './contract';

const apiClient = new KizunaClient(contract, {
    baseUrl: 'http://localhost:3000',
});

const api = new KizunaTanstackQuery(contract, apiClient);

const { data } = useQuery(
    api.users.getUser.queryOptions({
        input: {
            params: {
                id: '1',
            },
        },
    })
);
```

## Documentation

[TanStack Query client](https://ts-kizuna.com/docs/clients/tanstack-query)
