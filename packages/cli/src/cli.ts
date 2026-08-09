#!/usr/bin/env node
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { writeKizunaJsDoc, collectExportedSchemaDocs, patchDeclarationDocs, type ContractSource } from './jsdoc-parser.js';
import { loadContract } from './load-contract.js';
import { lintDeprecations } from './lint-deprecations.js';

const usage = `Usage: kizuna jsdoc <contract.ts...> [--output <dir>] [--export <name>] [--dts <dir>]

Writes jsdoc.json into .kizuna, keyed per contract. Generators read it at generate
time and apply the descriptions, examples, and deprecations it holds.

A contract path may be suffixed with the export to read: src/workspace.ts:workspaceContract.

Optional:
  --output <dir>   Output directory. Default: .kizuna
  --export <name>  Default export name when none is suffixed. Default: contract
  --dts <dir>      Re-inject schema-field JSDoc into emitted .d.ts files in <dir>,
                   so docs survive publishing and reach z.infer consumers.
`;

const die = (message: string, code = 1): never => {
    process.stderr.write(`${message}\n`);
    process.exit(code);
};

const main = async (): Promise<void> => {
    const argv = process.argv.slice(2);
    if (argv[0] !== 'jsdoc') die(usage, argv[0] ? 1 : 0);

    const { values, positionals } = parseArgs({
        args: argv.slice(1),
        options: {
            output: {
                type: 'string',
            },
            export: {
                type: 'string',
            },
            dts: {
                type: 'string',
            },
        },
        allowPositionals: true,
        strict: true,
    });

    if (positionals.length === 0) die('Missing contract path(s)\n\n' + usage);
    const defaultExport = values.export ?? 'contract';
    const outDir = resolve(process.cwd(), values.output ?? '.kizuna');

    const contracts: ContractSource[] = [];
    for (const positional of positionals) {
        const [pathPart, exportName = defaultExport] = positional.split(':');
        const contractPath = resolve(process.cwd(), pathPart!);
        const contract =
            (await loadContract(contractPath, exportName)) ?? die(`No \`${exportName}\` (or default) export found at ${contractPath}`);
        contracts.push({
            contract,
            contractPath,
        });
    }

    for (const { contractPath } of contracts) {
        for (const warning of lintDeprecations(contractPath)) {
            process.stderr.write(`Warning: ${warning.file}:${warning.line} ${warning.message}\n`);
        }
    }

    const written = writeKizunaJsDoc(contracts, outDir);
    process.stderr.write(`Wrote ${written}\n`);

    if (values.dts !== undefined) {
        const dtsDir = resolve(process.cwd(), values.dts);
        const fields = new Map<string, Map<string, string>>();
        for (const { contractPath } of contracts) {
            for (const [name, map] of collectExportedSchemaDocs(contractPath)) fields.set(name, map);
        }
        const result = patchDeclarationDocs(dtsDir, fields);
        process.stderr.write(
            `Patched JSDoc on ${result.injections} field(s) across ${result.filesChanged} of ${result.filesScanned} .d.ts file(s) in ${dtsDir}\n`
        );
    }
};

main().catch((error: unknown) => die(`Error: ${error instanceof Error ? error.message : String(error)}`));
