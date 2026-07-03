import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { generateOpenApi } from '@ts-kizuna/openapi';
import type { Contract } from '@ts-kizuna/core';
import { loadContract } from './load-contract.js';
import { die } from './die.js';
import { findRepositoryRoot, isGitRef, rerootIntoCheckout, withRefCheckout } from './git-checkout.js';

const usage = `Usage: kizuna breaking-changes <contract.ts> --base <git-ref> [options]

Compares the working-tree contract against its version at a git ref (branch,
tag, commit) and reports breaking changes via \`oasdiff breaking\`. Requires
oasdiff on PATH.

A contract path may be suffixed with the export to read: src/contract.ts:apiContract.

Options:
  --base <ref>               Git ref to compare against. Required.
  --export <name>            Default contract export name. Default: contract
  --format <name>            oasdiff output format (text, json, githubactions, ...). Default: text
  --fail-on <ERR|WARN>       Exit 1 when changes of this level or higher are found. Default: ERR
  --severity-levels <file>   Custom oasdiff severity-levels file, or \`none\` to
                             disable kizuna's defaults. Default: kizuna's levels
  --out <file>               Write the oasdiff report to a file instead of stdout
`;

const OASDIFF_INSTALL_INSTRUCTIONS = `oasdiff not found on PATH. Install it with one of:

  brew install oasdiff
  go install github.com/oasdiff/oasdiff@latest

or download a release from https://github.com/oasdiff/oasdiff/releases`;

/**
 * kizuna's default severity overrides. The generated Swift and Kotlin clients
 * decode response enums into closed, exhaustive types, so a new response enum
 * value breaks their decoding — oasdiff only warns by default.
 */
export const defaultSeverityLevels = (): string => {
    return 'response-property-enum-value-added err\n';
};

export interface BreakingChangesArguments {
    contractArgument: string;
    base: string;
    defaultExport: string;
    format: string;
    failOn: string;
    severityLevels: string | undefined;
    out: string | undefined;
}

export const parseBreakingChangesArguments = (argv: string[]): BreakingChangesArguments => {
    const { values, positionals } = parseArgs({
        args: argv,
        options: {
            base: {
                type: 'string',
            },
            export: {
                type: 'string',
            },
            format: {
                type: 'string',
            },
            'fail-on': {
                type: 'string',
            },
            'severity-levels': {
                type: 'string',
            },
            out: {
                type: 'string',
            },
            help: {
                type: 'boolean',
            },
        },
        allowPositionals: true,
        strict: true,
    });

    if (values.help) die(usage, 0);
    if (positionals.length !== 1) die(`Expected exactly one contract path\n\n${usage}`, 2);
    const base = values.base ?? die(`Missing --base\n\n${usage}`, 2);
    const failOn = values['fail-on'] ?? 'ERR';
    if (failOn !== 'ERR' && failOn !== 'WARN') die(`--fail-on must be ERR or WARN, got ${failOn}`, 2);

    return {
        contractArgument: positionals[0]!,
        base,
        defaultExport: values.export ?? 'contract',
        format: values.format ?? 'text',
        failOn,
        severityLevels: values['severity-levels'],
        out: values.out,
    };
};

/**
 * Verifies `--base` resolves to a commit in the repository containing `cwd`.
 */
export const resolveBaseRef = (base: string, cwd: string): string => {
    if (!isGitRef(base, cwd)) {
        throw new BreakingChangesError(`--base ${base} is not a git ref that resolves to a commit`);
    }
    return base;
};

/**
 * Splits a `path.ts:exportName` contract argument. The title and version in the
 * generated spec are placeholders — oasdiff's breaking checks ignore \`info\`.
 */
export const splitContractArgument = (contractArgument: string, defaultExport: string): { contractPath: string; exportName: string } => {
    const [pathPart, exportName = defaultExport] = contractArgument.split(':');
    return {
        contractPath: pathPart!,
        exportName,
    };
};

export const renderSpecFromContract = (contract: Contract): string => {
    const spec = generateOpenApi(contract, {
        info: {
            title: 'kizuna-breaking-changes',
            version: '0.0.0',
        },
    });
    return spec('yaml');
};

export const buildOasdiffArguments = (options: {
    baseSpecPath: string;
    revisionSpecPath: string;
    format: string;
    failOn: string;
    severityLevelsPath: string | undefined;
}): string[] => {
    return [
        'breaking',
        options.baseSpecPath,
        options.revisionSpecPath,
        '--format',
        options.format,
        '--fail-on',
        options.failOn,
        ...(options.severityLevelsPath !== undefined ? ['--severity-levels', options.severityLevelsPath] : []),
    ];
};

/**
 * Thrown for environment and usage failures. `process.exit` would skip
 * `finally` cleanup (scratch and checkout directories), so failures inside
 * the run are thrown and converted to an exit code at the top.
 */
export class BreakingChangesError extends Error {
    readonly exitCode: number;

    constructor(message: string, exitCode = 2) {
        super(message);
        this.exitCode = exitCode;
    }
}

const checkOasdiffAvailable = (): void => {
    const result = spawnSync('oasdiff', ['--version'], {
        stdio: 'ignore',
    });
    if (result.error !== undefined || result.status !== 0) throw new BreakingChangesError(OASDIFF_INSTALL_INSTRUCTIONS);
};

const loadContractOrThrow = async (contractPath: string, exportName: string): Promise<Contract> => {
    const contract = await loadContract(contractPath, exportName);
    if (contract === undefined) throw new BreakingChangesError(`No \`${exportName}\` (or default) export found at ${contractPath}`);
    return contract;
};

const generateBaseSpecFromRef = async (
    ref: string,
    absoluteContractPath: string,
    exportName: string,
    baseSpecPath: string,
    cwd: string
): Promise<void> => {
    const repositoryRoot = findRepositoryRoot(cwd);
    if (repositoryRoot === undefined) throw new BreakingChangesError('not inside a git repository');
    await withRefCheckout(ref, repositoryRoot, async (checkoutDirectory) => {
        const baseContractPath = rerootIntoCheckout(absoluteContractPath, repositoryRoot, checkoutDirectory);
        if (!fs.existsSync(baseContractPath)) {
            throw new BreakingChangesError(`contract file does not exist at ref ${ref} — nothing to compare against yet`);
        }
        let baseContract: Contract;
        try {
            baseContract = await loadContractOrThrow(baseContractPath, exportName);
        } catch (error) {
            if (error instanceof BreakingChangesError) throw error;
            const message = error instanceof Error ? error.message : String(error);
            throw new BreakingChangesError(`Failed to load contract at ref ${ref}: ${message}`);
        }
        fs.writeFileSync(baseSpecPath, renderSpecFromContract(baseContract));
    });
};

const runToExitCode = async (parsed: BreakingChangesArguments, cwd: string): Promise<number> => {
    const { contractPath, exportName } = splitContractArgument(parsed.contractArgument, parsed.defaultExport);
    const absoluteContractPath = path.resolve(cwd, contractPath);

    checkOasdiffAvailable();
    const baseRef = resolveBaseRef(parsed.base, cwd);

    const scratchDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'kizuna-breaking-changes-'));
    try {
        const revisionContract = await loadContractOrThrow(absoluteContractPath, exportName);
        const revisionSpecPath = path.join(scratchDirectory, 'revision.yaml');
        fs.writeFileSync(revisionSpecPath, renderSpecFromContract(revisionContract));

        const baseSpecPath = path.join(scratchDirectory, 'base.yaml');
        await generateBaseSpecFromRef(baseRef, absoluteContractPath, exportName, baseSpecPath, cwd);

        let severityLevelsPath: string | undefined;
        if (parsed.severityLevels === 'none') {
            severityLevelsPath = undefined;
        } else if (parsed.severityLevels !== undefined) {
            severityLevelsPath = path.resolve(cwd, parsed.severityLevels);
        } else {
            severityLevelsPath = path.join(scratchDirectory, 'severity-levels.txt');
            fs.writeFileSync(severityLevelsPath, defaultSeverityLevels());
        }

        const oasdiffArguments = buildOasdiffArguments({
            baseSpecPath,
            revisionSpecPath,
            format: parsed.format,
            failOn: parsed.failOn,
            severityLevelsPath,
        });
        const result = spawnSync('oasdiff', oasdiffArguments, {
            stdio: ['inherit', parsed.out !== undefined ? 'pipe' : 'inherit', 'inherit'],
            encoding: 'utf8',
        });
        if (parsed.out !== undefined) fs.writeFileSync(path.resolve(cwd, parsed.out), result.stdout ?? '');
        return result.status ?? 2;
    } finally {
        fs.rmSync(scratchDirectory, {
            recursive: true,
            force: true,
        });
    }
};

export const runBreakingChanges = async (argv: string[]): Promise<void> => {
    const parsed = parseBreakingChangesArguments(argv);
    try {
        process.exit(await runToExitCode(parsed, process.cwd()));
    } catch (error) {
        if (error instanceof BreakingChangesError) die(error.message, error.exitCode);
        throw error;
    }
};
