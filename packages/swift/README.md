# @ts-kizuna/swift

`@ts-kizuna/swift` generates a native Swift client from your ts-kizuna routes. The generated client uses `URLSession` and `Codable`, with no third-party Swift dependencies.

## Installation

```sh
pnpm add -D @ts-kizuna/swift
```

## Usage

```sh
ts-kizuna-swift generate --contract src/contract/index.ts --output ios/MyApp/Generated/APIClient.swift --namespace-name API
```

## Documentation

[Swift client generation](https://ts-kizuna.com/docs/clients/swift)
