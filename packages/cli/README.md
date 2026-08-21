# @ts-kizuna/cli

`loadContract` imports a contract module from TypeScript source, no build step needed. The Swift and Kotlin generators use it to load the contract they generate from.

## Installation

```sh
pnpm add -D @ts-kizuna/cli
```

## Usage

```ts
import { loadContract } from '@ts-kizuna/cli';

const contract = await loadContract('./src/contract.ts');
```

## Documentation

[ts-kizuna docs](https://ts-kizuna.com/docs)
