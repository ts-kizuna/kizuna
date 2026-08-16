import { describe, expect, test } from 'vitest';
import * as path from 'node:path';
import { withKizuna } from './config.js';

describe('withKizuna', () => {
    test('traces .kizuna at the project root by default', () => {
        expect(withKizuna({}).outputFileTracingIncludes).toEqual({
            '/*': ['.kizuna/**/*'],
        });
    });

    test('derives the glob from outputFileTracingRoot for monorepos', () => {
        const root = path.resolve(process.cwd(), '../..');
        const config = withKizuna({
            outputFileTracingRoot: root,
        });
        expect(config.outputFileTracingRoot).toBe(root);
        expect(config.outputFileTracingIncludes?.['/*']).toEqual(['../../.kizuna/**/*']);
    });

    test('preserves existing config and merges into existing includes', () => {
        const config = withKizuna({
            outputFileTracingIncludes: {
                '/*': ['./other/**/*'],
                '/api/x': ['./x/**/*'],
            },
        });
        expect(config.outputFileTracingIncludes).toEqual({
            '/*': ['./other/**/*', '.kizuna/**/*'],
            '/api/x': ['./x/**/*'],
        });
    });

    test('defaults to an empty config', () => {
        expect(withKizuna().outputFileTracingIncludes).toEqual({
            '/*': ['.kizuna/**/*'],
        });
    });
});
