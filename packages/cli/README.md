# @ts-kizuna/cli

The `kizuna` CLI extracts the deprecations declared on your contract into `.kizuna/deprecations.json`, which the OpenAPI and client generators read at generate time.

## Installation

```sh
pnpm add -D @ts-kizuna/cli
```

## Usage

Prepend it to your dev and build scripts, so the generators always read current data:

```sh
kizuna deprecations src/contract/index.ts
```

## Documentation

[Deprecations](https://ts-kizuna.com/docs/deprecations)
