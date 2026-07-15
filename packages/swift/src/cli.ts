#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { writeKizunaDeprecations, loadContract } from '@ts-kizuna/cli';
import { generateSwiftClient } from './generator.js';

const usage = `Usage: ts-kizuna-swift generate --contract <path> --output <path> --namespace-name <name>

Required:
  --contract <path>        TypeScript or JS module exporting a kizuna contract (k.contract).
                           Suffix with the export to read: src/api.ts:appContract.
  --output <path>          File path to write the generated .swift file.
  --namespace-name <name>  Public enum wrapping all generated types (e.g. MyAPI).

Optional:
  --camel-case             Convert wire field names to camelCase properties with CodingKeys.
                           Default: keep wire names verbatim.
  --export <name>          Export name when none is suffixed. Default: contract.
`;

const die = (message: string, code = 1): never => {
    process.stderr.write(`${message}\n`);
    process.exit(code);
};

const main = async (): Promise<void> => {
    const argv = process.argv.slice(2);
    const command = argv[0];
    if (command !== 'generate') {
        die(usage, command ? 1 : 0);
    }

    const { values } = parseArgs({
        args: argv.slice(1),
        options: {
            contract: {
                type: 'string',
            },
            output: {
                type: 'string',
            },
            'namespace-name': {
                type: 'string',
            },
            'camel-case': {
                type: 'boolean',
            },
            export: {
                type: 'string',
            },
        },
        strict: true,
    });

    const contractArg = values.contract ?? die('Missing --contract\n\n' + usage);
    const outArg = values.output ?? die('Missing --output\n\n' + usage);
    const namespaceName = values['namespace-name'] ?? die('Missing --namespace-name\n\n' + usage);

    const [pathPart, exportName = values.export ?? 'contract'] = contractArg.split(':');
    const contractPath = resolve(process.cwd(), pathPart!);
    const contract =
        (await loadContract(contractPath, exportName)) ?? die(`No \`${exportName}\` (or default) export found at ${contractPath}`);
    writeKizunaDeprecations([{ contract, contractPath }], resolve(process.cwd(), '.kizuna'));
    const swiftSource = generateSwiftClient(contract, {
        namespaceName,
        camelCaseProperties: values['camel-case'],
    });

    const outputPath = resolve(process.cwd(), outArg);
    mkdirSync(dirname(outputPath), {
        recursive: true,
    });
    writeFileSync(outputPath, swiftSource, 'utf8');

    process.stdout.write(`Wrote ${swiftSource.length} bytes to ${outputPath}\n`);
};

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    die(`Error: ${message}`);
});
