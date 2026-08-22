# @ts-kizuna/next

`@ts-kizuna/next` connects a ts-kizuna API to the Next.js App Router, as a catch-all route handler.

**Requires Next.js >= 16.**

## Installation

```sh
pnpm add @ts-kizuna/next
```

## Usage

Export the handlers from a catch-all route:

```ts
import { api } from '@/server/api';

export const { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS } = api.mount({
    basePath: '/api',
});
```

## Documentation

[Next.js adapter](https://ts-kizuna.com/docs/adapters/next)
