import { describe, expect, test } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const ROOT_README = path.join(ROOT, 'README.md');
const CORE_README = path.join(ROOT, 'packages', 'core', 'README.md');

/**
 * `@ts-kizuna/core` is the package consumers install first, so npm renders the
 * project's own front door on its page. That means the file is duplicated, and a
 * copy is only useful while it still matches.
 */
describe('core README', () => {
    test('is a verbatim copy of the root README', () => {
        const root = fs.readFileSync(ROOT_README, 'utf8');
        const core = fs.readFileSync(CORE_README, 'utf8');

        expect(core, 'packages/core/README.md has drifted from README.md, copy the root one over it').toBe(root);
    });

    test('carries no relative links, which npm would resolve against packages/core', () => {
        const core = fs.readFileSync(CORE_README, 'utf8');
        const targets = [...core.matchAll(/]\(([^)]+)\)/g)]
            .map((match) => match[1])
            .filter((target): target is string => target !== undefined);
        const relative = targets.filter((target) => !/^(https?:|#|mailto:)/.test(target));

        expect(relative, 'use absolute URLs so the npm page resolves them').toEqual([]);
    });
});
