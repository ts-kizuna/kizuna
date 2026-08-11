import { beforeAll, describe, expect, test } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { build, type Plugin } from 'esbuild';

const ROOT = path.resolve(import.meta.dirname, '..');
const PACKAGES_DIR = path.join(ROOT, 'packages');

type Reach = 'client' | 'server';

interface Entry {
    specifier: string;
    file: string;
    /**
     * Undefined when the package has not classified this subpath.
     */
    reach: Reach | undefined;
    external: string[];
}

/**
 * What bundling an entry needs, so the demo contract can go through the same
 * helpers without pretending to be an export subpath.
 */
type Bundleable = Pick<Entry, 'file' | 'external'>;

interface Manifest {
    name: string;
    exports?: Record<string, unknown>;
    peerDependencies?: Record<string, string>;
    kizuna?: {
        entries?: Record<string, Reach>;
    };
}

const readManifest = (packageDir: string): Manifest => JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));

/**
 * The file the `import` condition resolves to.
 */
const resolveImportTarget = (entry: unknown): string | undefined => {
    if (typeof entry === 'string') return entry;
    if (!entry || typeof entry !== 'object') return undefined;
    const record = entry as Record<string, unknown>;
    const imported = record['import'];
    if (typeof imported === 'string') return imported;
    if (imported && typeof imported === 'object') {
        const nested = (imported as Record<string, unknown>)['default'];
        if (typeof nested === 'string') return nested;
    }
    const fallback = record['default'];
    return typeof fallback === 'string' ? fallback : undefined;
};

const packageDirs = (): string[] =>
    fs
        .readdirSync(PACKAGES_DIR)
        .map((directory) => path.join(PACKAGES_DIR, directory))
        .filter((packageDir) => fs.existsSync(path.join(packageDir, 'package.json')));

/**
 * Every export subpath, with the reach its own package declares under
 * `kizuna.entries`.
 */
const collectEntries = (): Entry[] => {
    const entries: Entry[] = [];
    for (const packageDir of packageDirs()) {
        const manifest = readManifest(packageDir);
        // Workspace packages stay in the graph: a leak crosses their boundaries.
        const external = Object.keys(manifest.peerDependencies ?? {}).filter((name) => !name.startsWith('@ts-kizuna/'));
        for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
            const resolved = resolveImportTarget(target);
            if (resolved === undefined) continue;
            entries.push({
                specifier: subpath === '.' ? manifest.name : `${manifest.name}${subpath.slice(1)}`,
                file: path.join(packageDir, resolved),
                reach: manifest.kizuna?.entries?.[subpath],
                external,
            });
        }
    }
    return entries;
};

const NODE_BUILTIN =
    /^(node:|assert$|buffer$|child_process$|cluster$|crypto$|dns$|events$|fs$|http$|http2$|https$|inspector$|module$|net$|os$|path$|perf_hooks$|process$|querystring$|readline$|repl$|stream$|string_decoder$|timers$|tls$|tty$|url$|util$|v8$|vm$|worker_threads$|zlib$)/;

/**
 * Names the importer, so a failure carries the chain and not just the leaf.
 */
const rejectNodeBuiltins = (): Plugin => ({
    name: 'reject-node-builtins',
    setup(pluginBuild) {
        pluginBuild.onResolve({ filter: NODE_BUILTIN }, (args) => ({
            errors: [
                {
                    text: `${args.path} is imported by ${path.relative(ROOT, args.importer)}`,
                },
            ],
        }));
    },
});

/**
 * `no-conditions` is the same graph with no `browser` condition to swap a stub
 * in, so a package cannot pass by hiding the layering behind one.
 */
const bundleFailures = async (entry: Bundleable, mode: 'browser' | 'no-conditions'): Promise<string[]> => {
    const result = await build({
        entryPoints: [entry.file],
        bundle: true,
        write: false,
        logLevel: 'silent',
        format: 'esm',
        external: entry.external,
        plugins: [rejectNodeBuiltins()],
        ...(mode === 'browser'
            ? {
                  platform: 'browser' as const,
              }
            : {
                  platform: 'neutral' as const,
                  mainFields: ['module', 'main'],
                  conditions: ['import'],
              }),
    }).catch((error: { errors?: Array<{ text: string }> }) => error);

    const errors = 'errors' in result ? (result.errors ?? []) : [];
    return errors.map((issue) => issue.text);
};

/**
 * Every file a bundle pulled in, resolved through symlinks so a workspace
 * package looks the same however it was reached.
 */
const bundleInputs = async (entryFile: string, external: string[]): Promise<string[]> => {
    const result = await build({
        entryPoints: [entryFile],
        bundle: true,
        write: false,
        logLevel: 'silent',
        format: 'esm',
        platform: 'browser',
        metafile: true,
        external,
    });
    return Object.keys(result.metafile.inputs).map((input) => fs.realpathSync(path.resolve(ROOT, input)));
};

const entries = collectEntries();

describe('the client-safe boundary', () => {
    test('every export subpath declares its reach', () => {
        const unclassified = entries.filter((entry) => entry.reach === undefined).map((entry) => entry.specifier);
        expect(unclassified, 'add these under `kizuna.entries` in their own package.json').toEqual([]);

        const stale: string[] = [];
        for (const packageDir of packageDirs()) {
            const manifest = readManifest(packageDir);
            for (const subpath of Object.keys(manifest.kizuna?.entries ?? {})) {
                if (!(subpath in (manifest.exports ?? {}))) stale.push(`${manifest.name} declares '${subpath}', which it does not export`);
            }
        }
        expect(stale).toEqual([]);
    });

    test('dist is built', () => {
        const missing = entries.filter((entry) => !fs.existsSync(entry.file)).map((entry) => entry.specifier);
        expect(missing, 'run `pnpm build` first').toEqual([]);
    });

    const clientEntries = entries.filter((entry) => entry.reach === 'client');

    for (const entry of clientEntries) {
        for (const mode of ['browser', 'no-conditions'] as const) {
            test(`${entry.specifier} bundles for the browser (${mode})`, async () => {
                const failures = await bundleFailures(entry, mode);
                expect(failures, `${entry.specifier} reaches a Node built-in:\n${failures.join('\n')}`).toEqual([]);
            }, 60_000);
        }
    }
});

const DEMO_CONTRACT = path.join(ROOT, 'apps/shared/src/contract.ts');
const DEMO_KIZUNA = path.join(ROOT, 'apps/shared/src/k.ts');

describe('a contract stays client-safe end to end', () => {
    test('apps/shared contract bundles for the browser, plugins and all', async () => {
        const failures = await bundleFailures(
            {
                file: DEMO_CONTRACT,
                external: ['zod'],
            },
            'browser'
        );
        expect(failures, `the demo contract reaches a Node built-in:\n${failures.join('\n')}`).toEqual([]);
    }, 60_000);

    /**
     * Derived rather than declared, so labelling a client entry `server` to
     * quiet a failure is caught by the graph itself.
     */
    test('every entry the demo contract reaches is classified client', async () => {
        const byFile = new Map(entries.map((entry) => [fs.realpathSync(entry.file), entry.specifier]));
        const reached = (await bundleInputs(DEMO_CONTRACT, ['zod']))
            .map((input) => byFile.get(input))
            .filter((specifier): specifier is string => specifier !== undefined);

        const reachOf = new Map(entries.map((entry) => [entry.specifier, entry.reach]));
        const mislabelled = [...new Set(reached)].filter((specifier) => reachOf.get(specifier) !== 'client');
        expect(mislabelled, 'a contract reaches these, so they cannot be server-only').toEqual([]);
    }, 60_000);
});

/**
 * The server halves a declaration names, read off the bundled entry so the
 * pairing is checked against what ships, not against a second list. Bundling
 * drops comments, so a `serverModule` in an example does not count.
 */
const declaredServerModules = async (entry: Bundleable): Promise<string[]> => {
    const result = await build({
        entryPoints: [entry.file],
        bundle: true,
        write: false,
        logLevel: 'silent',
        format: 'esm',
        platform: 'browser',
        legalComments: 'none',
        external: entry.external,
    });
    const text = result.outputFiles[0]?.text ?? '';
    return Array.from(text.matchAll(/serverModule:\s*["']([^"']+)["']/g)).map((match) => match[1]!);
};

describe('every plugin is covered', () => {
    const declarations = new Map<string, string[]>();

    beforeAll(async () => {
        for (const entry of entries.filter((candidate) => candidate.reach === 'client')) {
            const serverModules = await declaredServerModules(entry);
            if (serverModules.length > 0) declarations.set(entry.specifier, serverModules);
        }
    }, 60_000);

    test('every declaration names a server half that exists', () => {
        const problems: string[] = [];
        for (const [specifier, serverModules] of declarations) {
            for (const serverModule of serverModules) {
                if (entries.find((entry) => entry.specifier === serverModule)?.reach !== 'server') {
                    problems.push(`${specifier} names '${serverModule}' as its server half, which is not a server entry`);
                }
            }
        }
        expect(problems).toEqual([]);
    });

    /**
     * Without this a new plugin could skip the end-to-end case above and rest on
     * the classification alone.
     */
    test('the demo contract installs every plugin', () => {
        const installed = fs.readFileSync(DEMO_KIZUNA, 'utf8');
        const missing = [...declarations.keys()].filter((specifier) => !installed.includes(`from '${specifier}'`));
        expect(missing, 'install these on apps/shared/src/k.ts').toEqual([]);
    });
});
