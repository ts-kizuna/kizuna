import * as fs from 'node:fs';
import * as path from 'node:path';
import { createDeprecationMap } from './deprecation.js';
import { serializeDeprecationMap } from './deprecation.js';

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
