import { describe, expect, test } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { kizunaDeprecations } from './tsdown.js';
import { deserializeDeprecationMap, type SerializedDeprecationMap } from './deprecation.js';

const fixturePath = path.resolve(import.meta.dirname, 'deprecation.fixture.ts');

describe('kizunaDeprecations', () => {
    test('returns a plugin with the correct name', () => {
        const plugin = kizunaDeprecations({
            contracts: [fixturePath],
        });
        expect(plugin.name).toBe('kizuna-deprecations');
    });

    test('writeBundle generates a deprecations JSON file per contract', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kizuna-tsdown-'));
        const plugin = kizunaDeprecations({
            contracts: [fixturePath],
        });

        (plugin as any).writeBundle(
            {
                dir: tmpDir,
            },
            {}
        );

        const outputPath = path.join(tmpDir, 'deprecation.fixture.deprecations.json');
        expect(fs.existsSync(outputPath)).toBe(true);

        const contents = JSON.parse(fs.readFileSync(outputPath, 'utf8')) as SerializedDeprecationMap;
        const map = deserializeDeprecationMap(contents);
        expect(map.routes.has('oldRoute')).toBe(true);
        expect(map.fields.get('getUser')?.has('responses.200.email')).toBe(true);

        fs.rmSync(tmpDir, {
            recursive: true,
        });
    });

    test('names output files by contract basename', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kizuna-tsdown-'));
        const plugin = kizunaDeprecations({
            contracts: [fixturePath],
        });

        (plugin as any).writeBundle(
            {
                dir: tmpDir,
            },
            {}
        );

        const files = fs.readdirSync(tmpDir);
        expect(files).toContain('deprecation.fixture.deprecations.json');

        fs.rmSync(tmpDir, {
            recursive: true,
        });
    });

    test('generateBundle injects @deprecated into .d.ts chunks using the fixture map', () => {
        const plugin = kizunaDeprecations({
            contracts: [fixturePath],
        });

        const bundle = {
            'index.d.ts': {
                type: 'chunk',
                fileName: 'index.d.ts',
                code: [
                    'declare const c: {',
                    '  readonly newRoute: {',
                    '    readonly body: z.ZodObject<{',
                    '      name: z.ZodString;',
                    '      fullName: z.ZodString;',
                    '    }, z.core.$strip>;',
                    '  };',
                    '};',
                    '',
                ].join('\n'),
            },
        };

        (plugin as any).generateBundle({}, bundle);

        expect(bundle['index.d.ts'].code).toMatch(/@deprecated\n\s+\*\/\n\s+name: z\.ZodString;/);
        expect(bundle['index.d.ts'].code).not.toMatch(/\*\/\n\s+fullName: z\.ZodString/);
    });

    test('generateBundle leaves non-.d.ts chunks untouched', () => {
        const plugin = kizunaDeprecations({
            contracts: [fixturePath],
        });
        const original = 'const name = 1;\n';
        const bundle = {
            'index.js': {
                type: 'chunk',
                fileName: 'index.js',
                code: original,
            },
        };

        (plugin as any).generateBundle({}, bundle);

        expect(bundle['index.js'].code).toBe(original);
    });
});
