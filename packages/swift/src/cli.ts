#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createJiti } from 'jiti';
import { type Contract } from '@ts-kizuna/core/generator';
import { generateSwiftClient } from './generator.js';

const usage = `Usage: ts-kizuna-swift generate --contract <path> --out <path> --namespace-name <name>

Required:
  --contract <path>        TypeScript or JS module exporting \`contract\` (or default-exporting one).
  --out <path>             File path to write the generated .swift file.
  --namespace-name <name>  Public enum wrapping all generated types (e.g. MyAPI).
`;

const die = (message: string, code = 1): never => {
    process.stderr.write(`${message}\n`);
    process.exit(code);
};

const loadContract = async (path: string): Promise<Contract> => {
    const absolute = resolve(process.cwd(), path);
    const jiti = createJiti(import.meta.url, {
        interopDefault: true,
    });
    const mod = (await jiti.import(absolute)) as { contract?: Contract; default?: Contract };
    const contract = mod.contract ?? mod.default;
    if (!contract) {
        die(`No \`contract\` or default export found at ${absolute}`);
    }
    return contract as Contract;
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
            out: {
                type: 'string',
            },
            'namespace-name': {
                type: 'string',
            },
        },
        strict: true,
    });

    const contractPath = values.contract ?? die('Missing --contract\n\n' + usage);
    const outArg = values.out ?? die('Missing --out\n\n' + usage);
    const namespaceName = values['namespace-name'] ?? die('Missing --namespace-name\n\n' + usage);

    const contract = await loadContract(contractPath);
    const swiftSource = generateSwiftClient(contract, {
        namespaceName,
        deprecationWarnings: {
            contractPath: resolve(process.cwd(), contractPath),
        },
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
