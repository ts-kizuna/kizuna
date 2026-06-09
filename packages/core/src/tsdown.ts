import * as fs from 'node:fs';
import * as path from 'node:path';
import { createDeprecationMap, serializeDeprecationMap } from './deprecation.js';
import { collectDeprecatedFieldNames, injectDeprecatedTags } from './inject-deprecations.js';

/**
 * Merge a `fieldName -> message` map into `target`, applying the same
 * "non-empty message wins" rule used by `collectDeprecatedFieldNames`.
 */
const mergeFieldNames = (target: Map<string, string>, source: Map<string, string>): void => {
    for (const [fieldName, message] of source) {
        const existing = target.get(fieldName);
        if (existing === undefined || (existing === '' && message !== '')) {
            target.set(fieldName, message);
        }
    }
};

type BundleFile =
    | {
          type: 'chunk';
          fileName: string;
          code: string;
      }
    | {
          type: 'asset';
          fileName: string;
          source: string | Uint8Array;
      };

interface KizunaDeprecationsOptions {
    /**
     * Contract `.ts` source file paths (relative to CWD or absolute).
     *
     * Each contract produces a `<basename>.deprecations.json` in the output directory.
     *
     * ```ts
     * kizunaDeprecations({
     *     contracts: ['src/contract/index.ts', 'src/contract/workspace.ts'],
     * })
     * ```
     */
    contracts: string[];
}

/**
 * tsdown plugin that generates serialized deprecation maps at build time.
 *
 * For each contract path, parses `@deprecated` JSDoc tags and writes a
 * `<basename>.deprecations.json` into the output directory. The JSON file
 * can be imported and passed directly to `generateOpenApi` or
 * `generateSwiftClient` as `deprecationWarnings`.
 *
 * It also injects `@deprecated` JSDoc into the emitted `.d.ts` declaration
 * chunks (in-memory, via `generateBundle`) so that published TypeScript
 * consumers see field-level deprecations that TypeScript's declaration emit
 * would otherwise strip. This is on by default.
 *
 * ```ts
 * // tsdown.config.ts
 * import { kizunaDeprecations } from '@ts-kizuna/core/tsdown';
 *
 * export default defineConfig({
 *     plugins: [
 *         kizunaDeprecations({
 *             contracts: ['src/contract/index.ts'],
 *         }),
 *     ],
 * });
 * ```
 */
export const kizunaDeprecations = (options: KizunaDeprecationsOptions) => {
    return {
        name: 'kizuna-deprecations',
        generateBundle(_outputOptions: unknown, bundle: Record<string, BundleFile>) {
            const deprecatedFields = new Map<string, string>();
            for (const contractPath of options.contracts) {
                const map = createDeprecationMap(path.resolve(contractPath));
                mergeFieldNames(deprecatedFields, collectDeprecatedFieldNames(map));
            }
            if (deprecatedFields.size === 0) return;

            for (const file of Object.values(bundle)) {
                if (!/\.d\.(m|c)?ts$/.test(file.fileName)) continue;
                const code = file.type === 'chunk' ? file.code : String(file.source);
                const next = injectDeprecatedTags(code, deprecatedFields);
                if (next === code) continue;
                if (file.type === 'chunk') file.code = next;
                else file.source = next;
            }
        },
        writeBundle(outputOptions: { dir?: string; file?: string }) {
            const outDir = outputOptions.dir ?? (outputOptions.file ? path.dirname(outputOptions.file) : undefined);
            if (!outDir) return;
            for (const contractPath of options.contracts) {
                const resolved = path.resolve(contractPath);
                const map = createDeprecationMap(resolved);
                const serialized = serializeDeprecationMap(map);
                const basename = path.basename(resolved, '.ts');
                fs.writeFileSync(path.join(outDir, `${basename}.deprecations.json`), JSON.stringify(serialized), 'utf8');
            }
        },
    };
};
