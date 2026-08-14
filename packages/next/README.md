# @ts-kizuna/next

`@ts-kizuna/next` connects a ts-kizuna API to the Next.js App Router, as a catch-all route handler.

**Requires Next.js >= 16.**

## Installation

```sh
pnpm add @ts-kizuna/next
```

## Usage

Wrap your `next.config.ts`:

```ts
import type { NextConfig } from 'next';
import { withKizuna } from '@ts-kizuna/next/config';

const nextConfig: NextConfig = {};

export default withKizuna(nextConfig);
```

Then export the handlers from a catch-all route:

```ts
import { api } from '@/server/api';

export const { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS } = api.mount({
    basePath: '/api',
});
```

## Documentation

[Next.js adapter](https://ts-kizuna.com/docs/adapters/next)
