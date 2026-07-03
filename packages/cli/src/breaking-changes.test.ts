import { describe, expect, test } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { z } from 'zod';
import { kizuna } from '@ts-kizuna/core';
import {
    BreakingChangesError,
    buildOasdiffArguments,
    defaultSeverityLevels,
    parseBreakingChangesArguments,
    renderSpecFromContract,
    resolveBaseRef,
    splitContractArgument,
} from './breaking-changes.js';
import { findRepositoryRoot, isGitRef, rerootIntoCheckout, withRefCheckout } from './git-checkout.js';

const { k } = kizuna();

const makeTempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'kizuna-breaking-changes-test-'));

const makeGitRepository = (): string => {
    const dir = makeTempDir();
    const git = (...gitArguments: string[]): string =>
        execFileSync('git', gitArguments, {
            cwd: dir,
            encoding: 'utf8',
        }).trim();
    git('init');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    fs.writeFileSync(path.join(dir, 'file.txt'), 'one\n');
    git('add', '.');
    git('commit', '-m', 'initial');
    return dir;
};

describe('parseBreakingChangesArguments', () => {
    test('applies defaults', () => {
        const parsed = parseBreakingChangesArguments(['src/contract.ts', '--base', 'main']);
        expect(parsed).toEqual({
            contractArgument: 'src/contract.ts',
            base: 'main',
            defaultExport: 'contract',
            format: 'text',
            failOn: 'ERR',
            severityLevels: undefined,
            out: undefined,
        });
    });

    test('accepts explicit flags', () => {
        const parsed = parseBreakingChangesArguments([
            'src/contract.ts:apiContract',
            '--base',
            'openapi.yaml',
            '--format',
            'json',
            '--fail-on',
            'WARN',
            '--severity-levels',
            'none',
            '--out',
            'report.json',
        ]);
        expect(parsed.format).toBe('json');
        expect(parsed.failOn).toBe('WARN');
        expect(parsed.severityLevels).toBe('none');
        expect(parsed.out).toBe('report.json');
    });
});

describe('splitContractArgument', () => {
    test('splits an explicit export suffix', () => {
        expect(splitContractArgument('src/contract.ts:apiContract', 'contract')).toEqual({
            contractPath: 'src/contract.ts',
            exportName: 'apiContract',
        });
    });

    test('falls back to the default export name', () => {
        expect(splitContractArgument('src/contract.ts', 'contract')).toEqual({
            contractPath: 'src/contract.ts',
            exportName: 'contract',
        });
    });
});

describe('resolveBaseRef', () => {
    test('accepts a commit-ish', () => {
        const repository = makeGitRepository();
        expect(resolveBaseRef('HEAD', repository)).toBe('HEAD');
        fs.rmSync(repository, {
            recursive: true,
            force: true,
        });
    });

    test('throws when the base is not a git ref', () => {
        const repository = makeGitRepository();
        expect(() => resolveBaseRef('no-such-thing', repository)).toThrow(BreakingChangesError);
        fs.rmSync(repository, {
            recursive: true,
            force: true,
        });
    });
});

describe('defaultSeverityLevels', () => {
    test('elevates response enum additions to err for closed native-client enums', () => {
        expect(defaultSeverityLevels()).toBe('response-property-enum-value-added err\n');
    });
});

describe('buildOasdiffArguments', () => {
    test('assembles the breaking subcommand argv', () => {
        expect(
            buildOasdiffArguments({
                baseSpecPath: '/tmp/base.yaml',
                revisionSpecPath: '/tmp/revision.yaml',
                format: 'json',
                failOn: 'ERR',
                severityLevelsPath: '/tmp/levels.txt',
            })
        ).toEqual([
            'breaking',
            '/tmp/base.yaml',
            '/tmp/revision.yaml',
            '--format',
            'json',
            '--fail-on',
            'ERR',
            '--severity-levels',
            '/tmp/levels.txt',
        ]);
    });

    test('omits --severity-levels when disabled', () => {
        expect(
            buildOasdiffArguments({
                baseSpecPath: 'base.yaml',
                revisionSpecPath: 'revision.yaml',
                format: 'text',
                failOn: 'WARN',
                severityLevelsPath: undefined,
            })
        ).not.toContain('--severity-levels');
    });
});

describe('renderSpecFromContract', () => {
    test('renders YAML with placeholder info', () => {
        const contract = k.contract({
            routes: {
                getUser: {
                    method: 'GET',
                    path: '/users/:id',
                    responses: {
                        200: z.object({
                            id: z.string(),
                        }),
                    },
                },
            },
        });
        const yaml = renderSpecFromContract(contract);
        expect(yaml).toContain('title: kizuna-breaking-changes');
        expect(yaml).toContain('/users/{id}');
    });
});

describe('git-checkout', () => {
    test('findRepositoryRoot returns the repo root and undefined outside a repo', () => {
        const repository = makeGitRepository();
        expect(fs.realpathSync(findRepositoryRoot(repository)!)).toBe(fs.realpathSync(repository));
        const plainDir = makeTempDir();
        // os.tmpdir() itself is not a repo, so a fresh temp dir has no root above it.
        expect(findRepositoryRoot(plainDir)).toBeUndefined();
        fs.rmSync(repository, {
            recursive: true,
            force: true,
        });
        fs.rmSync(plainDir, {
            recursive: true,
            force: true,
        });
    });

    test('isGitRef distinguishes commits from garbage', () => {
        const repository = makeGitRepository();
        expect(isGitRef('HEAD', repository)).toBe(true);
        expect(isGitRef('does-not-exist', repository)).toBe(false);
        fs.rmSync(repository, {
            recursive: true,
            force: true,
        });
    });

    test('rerootIntoCheckout maps a repo path into the checkout', () => {
        expect(rerootIntoCheckout('/repo/src/contract.ts', '/repo', '/checkout')).toBe(path.join('/checkout', 'src/contract.ts'));
    });

    test('withRefCheckout exports the ref and cleans up, also on failure', async () => {
        const repository = makeGitRepository();
        const repositoryRoot = findRepositoryRoot(repository)!;
        fs.writeFileSync(path.join(repository, 'file.txt'), 'two\n');

        let seenContent = '';
        let seenDirectory = '';
        await withRefCheckout('HEAD', repositoryRoot, async (checkoutDirectory) => {
            seenDirectory = checkoutDirectory;
            seenContent = fs.readFileSync(path.join(checkoutDirectory, 'file.txt'), 'utf8');
        });
        // the checkout sees the committed version, not the working tree edit
        expect(seenContent).toBe('one\n');
        expect(fs.existsSync(seenDirectory)).toBe(false);

        await expect(
            withRefCheckout('HEAD', repositoryRoot, async (checkoutDirectory) => {
                seenDirectory = checkoutDirectory;
                throw new Error('callback failure');
            })
        ).rejects.toThrow('callback failure');
        expect(fs.existsSync(seenDirectory)).toBe(false);

        fs.rmSync(repository, {
            recursive: true,
            force: true,
        });
    });

    test('withRefCheckout symlinks node_modules into the checkout', async () => {
        const repository = makeGitRepository();
        const repositoryRoot = findRepositoryRoot(repository)!;
        fs.mkdirSync(path.join(repository, 'node_modules'));
        fs.writeFileSync(path.join(repository, 'node_modules', 'marker.txt'), 'installed\n');

        await withRefCheckout('HEAD', repositoryRoot, async (checkoutDirectory) => {
            expect(fs.readFileSync(path.join(checkoutDirectory, 'node_modules', 'marker.txt'), 'utf8')).toBe('installed\n');
        });

        fs.rmSync(repository, {
            recursive: true,
            force: true,
        });
    });

    test('withRefCheckout leaves no worktree metadata in the repository', async () => {
        const repository = makeGitRepository();
        const repositoryRoot = findRepositoryRoot(repository)!;
        await withRefCheckout('HEAD', repositoryRoot, async () => {});
        expect(fs.existsSync(path.join(repository, '.git', 'worktrees'))).toBe(false);
        fs.rmSync(repository, {
            recursive: true,
            force: true,
        });
    });
});

const oasdiffAvailable = spawnSync('oasdiff', ['--version'], { stdio: 'ignore' }).status === 0;

describe.skipIf(!oasdiffAvailable)('end-to-end with oasdiff', () => {
    const runOasdiff = (baseYaml: string, revisionYaml: string, severityLevels: string | undefined): number => {
        const dir = makeTempDir();
        fs.writeFileSync(path.join(dir, 'base.yaml'), baseYaml);
        fs.writeFileSync(path.join(dir, 'revision.yaml'), revisionYaml);
        let severityLevelsPath: string | undefined;
        if (severityLevels !== undefined) {
            severityLevelsPath = path.join(dir, 'levels.txt');
            fs.writeFileSync(severityLevelsPath, severityLevels);
        }
        const result = spawnSync(
            'oasdiff',
            buildOasdiffArguments({
                baseSpecPath: path.join(dir, 'base.yaml'),
                revisionSpecPath: path.join(dir, 'revision.yaml'),
                format: 'text',
                failOn: 'ERR',
                severityLevelsPath,
            }),
            {
                stdio: 'ignore',
            }
        );
        fs.rmSync(dir, {
            recursive: true,
            force: true,
        });
        return result.status ?? -1;
    };

    const contractSpec = (statusEnum: string[], withEmail: boolean): string => {
        const contract = k.contract({
            routes: {
                getOrder: {
                    method: 'GET',
                    path: '/orders/:id',
                    responses: {
                        200: z.object({
                            id: z.string(),
                            status: z.enum(statusEnum as [string, ...string[]]),
                            ...(withEmail
                                ? {
                                      email: z.string(),
                                  }
                                : {}),
                        }),
                    },
                },
            },
        });
        return renderSpecFromContract(contract);
    };

    test('removed response field fails under oasdiff defaults', () => {
        const base = contractSpec(['open', 'closed'], true);
        const revision = contractSpec(['open', 'closed'], false);
        expect(runOasdiff(base, revision, undefined)).toBe(1);
    });

    test('added response enum value passes plain oasdiff but fails under kizuna levels', () => {
        const base = contractSpec(['open', 'closed'], true);
        const revision = contractSpec(['open', 'closed', 'archived'], true);
        expect(runOasdiff(base, revision, undefined)).toBe(0);
        expect(runOasdiff(base, revision, defaultSeverityLevels())).toBe(1);
    });

    test('identical contracts pass', () => {
        const base = contractSpec(['open', 'closed'], true);
        expect(runOasdiff(base, base, defaultSeverityLevels())).toBe(0);
    });
});
