import * as fs from 'node:fs';
import { makeResolverWithCache } from './deprecation-parser.js';

export interface DeprecationLintWarning {
    file: string;
    line: number;
    message: string;
}

const editDistance = (a: string, b: string): number => {
    const rows = Array.from({ length: a.length + 1 }, (_, index) => [index, ...new Array<number>(b.length).fill(0)]);
    for (let column = 0; column <= b.length; column += 1) rows[0]![column] = column;
    for (let row = 1; row <= a.length; row += 1) {
        for (let column = 1; column <= b.length; column += 1) {
            const cost = a[row - 1] === b[column - 1] ? 0 : 1;
            rows[row]![column] = Math.min(rows[row - 1]![column]! + 1, rows[row]![column - 1]! + 1, rows[row - 1]![column - 1]! + cost);
        }
    }
    return rows[a.length]![b.length]!;
};

const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length;

/**
 * Warns about JSDoc that would silently disable a deprecation, a misspelled
 * `@deprecated` tag, or more than one on the same comment. Scans the contract
 * source and the files it imports.
 */
export const lintDeprecations = (entryPath: string): DeprecationLintWarning[] => {
    const { cache } = makeResolverWithCache(entryPath);
    const warnings: DeprecationLintWarning[] = [];

    for (const filePath of cache.keys()) {
        const text = fs.readFileSync(filePath, 'utf8');
        for (const block of text.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
            const blockStart = block.index;
            const tags = [...block[0].matchAll(/@(\w+)/g)];

            const deprecatedTags = tags.filter((tag) => tag[1] === 'deprecated');
            if (deprecatedTags.length > 1) {
                warnings.push({
                    file: filePath,
                    line: lineOf(text, blockStart + deprecatedTags[1]!.index),
                    message: 'Duplicate `@deprecated` tag in one comment, only the first message is used.',
                });
            }

            for (const tag of tags) {
                const name = tag[1]!.toLowerCase();
                if (name !== 'deprecated' && name.startsWith('dep') && editDistance(name, 'deprecated') <= 2) {
                    warnings.push({
                        file: filePath,
                        line: lineOf(text, blockStart + tag.index),
                        message: `\`@${tag[1]}\` looks like a typo of \`@deprecated\`, it will be ignored.`,
                    });
                }
            }
        }
    }

    return warnings;
};
