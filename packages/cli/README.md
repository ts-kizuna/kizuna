# @ts-kizuna/cli

The `kizuna` CLI re-injects schema-field JSDoc into the `.d.ts` files your build emits, so docs survive publishing and reach `z.infer` consumers. It also ships `loadContract`, which the Swift and Kotlin generators use to load a contract from source.

## Installation

```sh
pnpm add -D @ts-kizuna/cli
```

## Usage

Run it after your build, pointing at the emitted declarations:

```sh
kizuna dts src/index.ts --out dist
```

## Documentation

[kizuna dts](https://ts-kizuna.com/docs/reference/kizuna-dts)
