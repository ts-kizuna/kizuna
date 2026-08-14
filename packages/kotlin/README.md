# @ts-kizuna/kotlin

`@ts-kizuna/kotlin` generates a native Kotlin client from your ts-kizuna contract. The generated client uses OkHttp for HTTP, kotlinx.serialization for JSON, and Kotlin coroutines for async.

## Installation

```sh
pnpm add -D @ts-kizuna/kotlin
```

## Usage

```sh
ts-kizuna-kotlin generate --contract src/contract/index.ts --out android/app/src/main/kotlin/com/example/APIClient.kt --namespace-name API --package com.example
```

## Documentation

[Kotlin client generation](https://ts-kizuna.com/docs/clients/kotlin)
