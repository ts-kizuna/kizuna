# @ts-kizuna/openapi

`@ts-kizuna/openapi` generates an OpenAPI 3.1.0 document from your contract, and serves it with a reference UI on any adapter.

## Installation

```sh
pnpm add @ts-kizuna/openapi
```

## Usage

Declare the plugin on `new Kizuna()`:

```ts
import { Kizuna } from '@ts-kizuna/core';
import { openApiPlugin } from '@ts-kizuna/openapi';

export const k = new Kizuna({
    plugins: {
        openApi: openApiPlugin({
            info: {
                title: 'My API',
                version: '1.0.0',
            },
        }),
    },
});
```

Then pass its server half to `server.api`, where the generator lives:

```ts
import { openApiPluginServer } from '@ts-kizuna/openapi/server';

export const api = server.api({
    router,
    plugins: {
        openApi: openApiPluginServer(),
    },
});
```

## Documentation

[OpenAPI generation](https://ts-kizuna.com/docs/openapi)
