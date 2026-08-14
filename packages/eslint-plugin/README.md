# @ts-kizuna/eslint-plugin

`@ts-kizuna/eslint-plugin` catches ts-kizuna mistakes in your editor, as you type. These are things the type system cannot express on its own.

## Installation

```sh
pnpm add -D @ts-kizuna/eslint-plugin
```

## Usage

Add the recommended config to your `eslint.config.js`:

```js
import kizuna from '@ts-kizuna/eslint-plugin';

export default [kizuna.configs.recommended];
```

## Documentation

[ESLint plugin](https://ts-kizuna.com/docs/eslint)
