#!/usr/bin/env node
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { collectExportedSchemaDocs } from './schema-exports.js';
import { patchDeclarationDocs } from './dts-jsdoc.js';

const usage = `Usage: kizuna dts <contract.ts...> --out <dir>

Re-injects schema-field JSDoc into the emitted .d.ts files in <dir>, so docs
survive publishing and reach z.infer consumers.

Required:
  --out <dir>      The directory holding the emitted .d.ts files.
`;

const die = (message: string, code = 1): never => {
    process.stderr.write(`${message}\n`);
    process.exit(code);
};

const main = (): void => {
    const argv = process.argv.slice(2);
    if (argv[0] !== 'dts') die(usage, argv[0] ? 1 : 0);

    const { values, positionals } = parseArgs({
        args: argv.slice(1),
        options: {
            out: {
                type: 'string',
            },
        },
        allowPositionals: true,
        strict: true,
    });

    if (positionals.length === 0) die('Missing contract path(s)\n\n' + usage);

    const dtsDir = resolve(process.cwd(), values.out ?? die('Missing --out <dir>\n\n' + usage));
    const fields = new Map<string, Map<string, string>>();
    for (const positional of positionals) {
        const contractPath = resolve(process.cwd(), positional);
        for (const [name, map] of collectExportedSchemaDocs(contractPath)) fields.set(name, map);
    }
    const result = patchDeclarationDocs(dtsDir, fields);
    process.stderr.write(
        `Patched JSDoc on ${result.injections} field(s) across ${result.filesChanged} of ${result.filesScanned} .d.ts file(s) in ${dtsDir}\n`
    );
};

try {
    main();
} catch (error: unknown) {
    die(`Error: ${error instanceof Error ? error.message : String(error)}`);
}
