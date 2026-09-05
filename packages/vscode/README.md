# ts-kizuna for VS Code

Shows [ts-kizuna](https://ts-kizuna.com) deprecations where you code: deprecated routes and fields are struck through everywhere the contract's types flow, and hovering shows the migration message.

Deprecations are declared once, on the contract:

```ts
deleteUser: {
    method: 'DELETE',
    path: '/users/:id',
    deprecated: 'use archiveUser instead',
    // ...
},
```

The extension picks them up with zero configuration, and stays inert in projects that don't use ts-kizuna.

[Documentation](https://ts-kizuna.com/docs/vscode)

## Other editors

VS Code and its forks are the tested ground. The extension carries `@ts-kizuna/typescript-plugin`, a TypeScript language service plugin, and any editor that runs the TypeScript server can load it through `tsconfig.json` instead, covered in the [documentation](https://ts-kizuna.com/docs/vscode#other-editors).

## Developing

From the repository root:

```sh
code --extensionDevelopmentPath="$PWD/packages/vscode" .
```

It opens an Extension Development Host on this repository; open `packages/typescript-plugin/src/deprecation.fixture.ts` there to see the deprecations. Rebuild `@ts-kizuna/typescript-plugin` and restart the TS server in the host after changing the plugin.
