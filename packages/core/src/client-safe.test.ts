import { describe, expect, test } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Kizuna } from './kizuna.js';

const DIST_DIR = path.resolve(import.meta.dirname, '../dist');

const NODE_BUILTINS = ['node:fs', 'node:path', 'node:child_process', 'node:os', 'node:crypto'];

function collectContent(entryFile: string): string {
    const entry = fs.readFileSync(entryFile, 'utf8');
    const localImports = Array.from(entry.matchAll(/from\s+["'](\.\/[^"']+)["']/g)).map((m) => m[1]!);
    const parts = [entry];
    for (const rel of localImports) {
        const full = path.join(DIST_DIR, rel);
        if (fs.existsSync(full)) {
            parts.push(fs.readFileSync(full, 'utf8'));
        }
    }
    return parts.join('\n');
}

describe('main entry point is client-safe', () => {
    test('index.mjs and its chunks do not import Node built-in modules', () => {
        const content = collectContent(path.join(DIST_DIR, 'index.mjs'));
        for (const builtin of NODE_BUILTINS) {
            expect(content, `found "${builtin}" in main entry bundle`).not.toContain(builtin);
        }
    });
});
