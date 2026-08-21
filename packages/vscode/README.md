# ts-kizuna for VS Code

Shows ts-kizuna deprecations in the editor: strikethrough on deprecated routes and fields, the migration message on hover, and struck-through entries in completions.

The extension carries `@ts-kizuna/typescript-plugin` into the TypeScript server VS Code already runs. Installing it is the whole setup. In editors without the extension, add the plugin to `tsconfig.json` instead:

```json
{
    "compilerOptions": {
        "plugins": [
            {
                "name": "@ts-kizuna/typescript-plugin"
            }
        ]
    }
}
```

## Developing

Run the `Run ts-kizuna extension` launch configuration (F5) from the repository root. It opens an Extension Development Host on this repository; open `packages/typescript-plugin/src/poc.fixture.ts` there to see the deprecations. Rebuild `@ts-kizuna/typescript-plugin` and restart the TS server in the host after changing the plugin.
