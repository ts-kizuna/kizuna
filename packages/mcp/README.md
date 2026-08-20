# @ts-kizuna/mcp

`@ts-kizuna/mcp` adds an MCP (Model Context Protocol) endpoint to your API. Each route becomes a tool that AI assistants can discover and call.

## Installation

```sh
pnpm add @ts-kizuna/mcp
```

## Usage

Declare the plugin on `k.contract`:

```ts
import { mcpPlugin } from '@ts-kizuna/mcp';
import { k } from './k';
import { routes } from './routes';

export const contract = k.contract({
    routes,
    plugins: {
        mcp: mcpPlugin({
            name: 'My API',
        }),
    },
});
```

Then pass its server half to `server.api`, where the MCP SDK and the transport live:

```ts
import { mcpPluginServer } from '@ts-kizuna/mcp/server';

export const api = server.api({
    router,
    plugins: {
        mcp: mcpPluginServer(),
    },
});
```

## Documentation

[MCP server generation](https://ts-kizuna.com/docs/mcp)
