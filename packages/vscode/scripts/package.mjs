/**
 * Package the extension into a vsix.
 *
 * VS Code resolves a `typescriptServerPlugins` name through node resolution from
 * the extension folder, so the plugin has to travel inside the vsix. It is staged
 * outside the repo, because the `node_modules` entry here is a pnpm symlink.
 */
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const extension = resolve(import.meta.dirname, '..');
const plugin = resolve(extension, '../typescript-plugin');
const output = process.argv[2] ?? join(extension, 'ts-kizuna.vsix');

const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: 'inherit' });

run('pnpm', ['--filter', '@ts-kizuna/typescript-plugin', 'build'], resolve(extension, '../..'));

const stage = await mkdtemp(join(tmpdir(), 'ts-kizuna-vsix-'));
try {
    for (const file of ['package.json', 'README.md', 'icon.png']) {
        await cp(join(extension, file), join(stage, file));
    }

    const source = join(stage, 'plugin');
    await mkdir(source, { recursive: true });
    await cp(join(plugin, 'dist'), join(source, 'dist'), { recursive: true });
    // npm cannot read pnpm's catalog protocol, and the plugin is already built.
    const pluginManifest = JSON.parse(await readFile(join(plugin, 'package.json'), 'utf8'));
    await writeFile(
        join(source, 'package.json'),
        JSON.stringify(
            {
                ...pluginManifest,
                scripts: undefined,
                devDependencies: undefined,
            },
            null,
            2
        )
    );

    // vsce reads the version from the manifest, and rejects the workspace protocol.
    const manifest = JSON.parse(await readFile(join(extension, 'package.json'), 'utf8'));
    const { version } = JSON.parse(await readFile(resolve(extension, '../core/package.json'), 'utf8'));
    await writeFile(
        join(stage, 'package.json'),
        JSON.stringify(
            {
                ...manifest,
                version,
                dependencies: {
                    '@ts-kizuna/typescript-plugin': pluginManifest.version,
                },
            },
            null,
            2
        )
    );

    const installed = join(stage, 'node_modules/@ts-kizuna/typescript-plugin');
    await mkdir(installed, { recursive: true });
    await cp(source, installed, { recursive: true });
    await rm(source, { recursive: true, force: true });
    run('pnpm', ['dlx', '@vscode/vsce@latest', 'package', '--out', output], stage);
} finally {
    await rm(stage, { recursive: true, force: true });
}
