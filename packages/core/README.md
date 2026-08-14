# @ts-kizuna/core

`@ts-kizuna/core` defines the routes and the contract a ts-kizuna project is built from, and validates every request against them.

## Installation

```sh
pnpm add @ts-kizuna/core zod
```

## Usage

```ts
import { Kizuna } from '@ts-kizuna/core';
import { ProblemDetailsSchema } from '@ts-kizuna/core/schemas';
import { z } from 'zod';

const k = new Kizuna();

const users = k.routes({
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

export const contract = k.contract({
    routes: {
        users,
    },
});
```

## Documentation

[ts-kizuna documentation](https://ts-kizuna.com/docs)
