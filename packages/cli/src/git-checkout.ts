import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

const runGit = (cwd: string, ...gitArguments: string[]): { status: number; stdout: string; stderr: string } => {
    const result = spawnSync('git', gitArguments, {
        cwd,
        encoding: 'utf8',
    });
    return {
        status: result.status ?? 1,
        stdout: (result.stdout ?? '').trim(),
        stderr: (result.stderr ?? '').trim(),
    };
};

/**
 * Returns the repository root containing `cwd`, or undefined when `cwd` is not
 * inside a git repository.
 */
export const findRepositoryRoot = (cwd: string): string | undefined => {
    const result = runGit(cwd, 'rev-parse', '--show-toplevel');
    return result.status === 0 ? result.stdout : undefined;
};

/**
 * True when `ref` resolves to a commit in the repository containing `cwd`.
 */
export const isGitRef = (ref: string, cwd: string): boolean => {
    return runGit(cwd, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`).status === 0;
};

/**
 * Exports `ref`'s files into a temporary directory via `git archive`, symlinks
 * the repository's `node_modules` directories into it so imports resolve, runs
 * `callback` with the directory, and deletes it afterwards. Read-only on the
 * repository — no worktree bookkeeping.
 */
export const withRefCheckout = async <Result>(
    ref: string,
    repositoryRoot: string,
    callback: (checkoutDirectory: string) => Promise<Result>
): Promise<Result> => {
    const checkoutDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'kizuna-checkout-'));
    try {
        const archivePath = path.join(checkoutDirectory, '.kizuna-archive.tar');
        const archived = runGit(repositoryRoot, 'archive', '--format=tar', '-o', archivePath, ref);
        if (archived.status !== 0) throw new Error(`git archive failed for ref ${ref}: ${archived.stderr}`);
        const extracted = spawnSync('tar', ['-xf', archivePath, '-C', checkoutDirectory]);
        if (extracted.status !== 0) throw new Error(`extracting the archive for ref ${ref} failed`);
        fs.rmSync(archivePath);
        linkNodeModules(repositoryRoot, checkoutDirectory);
        return await callback(checkoutDirectory);
    } finally {
        fs.rmSync(checkoutDirectory, {
            recursive: true,
            force: true,
        });
    }
};

/**
 * Symlinks every `node_modules` directory found under the repository root into
 * the same relative location in the checkout, so the exported contract resolves
 * bare imports against the currently installed dependencies.
 */
const linkNodeModules = (repositoryRoot: string, checkoutDirectory: string): void => {
    const pending: string[] = [''];
    while (pending.length > 0) {
        const relativeDirectory = pending.pop()!;
        const sourceDirectory = path.join(repositoryRoot, relativeDirectory);
        for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            if (entry.name === '.git') continue;
            const relativeEntry = path.join(relativeDirectory, entry.name);
            if (entry.name === 'node_modules') {
                const linkPath = path.join(checkoutDirectory, relativeEntry);
                if (fs.existsSync(path.dirname(linkPath)) && !fs.existsSync(linkPath)) {
                    fs.symlinkSync(path.join(repositoryRoot, relativeEntry), linkPath, 'dir');
                }
                continue;
            }
            pending.push(relativeEntry);
        }
    }
};

/**
 * Re-roots an absolute path inside the repository to the same relative location
 * inside the checkout directory.
 */
export const rerootIntoCheckout = (absolutePath: string, repositoryRoot: string, checkoutDirectory: string): string => {
    return path.join(checkoutDirectory, path.relative(repositoryRoot, absolutePath));
};
