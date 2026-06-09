import { describe, expect, test } from 'vitest';
import { collectDeprecatedFieldNames, injectDeprecatedTags } from './inject-deprecations.js';
import type { DeprecationMap } from './deprecation.js';

describe('collectDeprecatedFieldNames', () => {
    test('flattens fields and schemas to last-segment field names', () => {
        const map: DeprecationMap = {
            routes: new Map(),
            fields: new Map([
                [
                    'getUser',
                    new Map([
                        ['responses.200.email', ''],
                        ['responses.200.images.portrait.media_id', 'Use `image_id` instead.'],
                    ]),
                ],
            ]),
            schemas: new Map([['User', new Map([['profile_id', '']])]]),
        };

        const names = collectDeprecatedFieldNames(map);

        expect(names.get('email')).toBe('');
        expect(names.get('media_id')).toBe('Use `image_id` instead.');
        expect(names.get('profile_id')).toBe('');
        expect(names.size).toBe(3);
    });

    test('prefers a non-empty message over an empty one for the same name', () => {
        const map: DeprecationMap = {
            routes: new Map(),
            fields: new Map([
                ['routeA', new Map([['responses.200.email', '']])],
                ['routeB', new Map([['responses.200.email', 'Use email_address instead.']])],
            ]),
        };

        const names = collectDeprecatedFieldNames(map);

        expect(names.get('email')).toBe('Use email_address instead.');
    });
});

describe('injectDeprecatedTags', () => {
    const names = new Map<string, string>([
        ['mediaId', 'Use `image_id` instead.'],
        ['email', ''],
    ]);

    test('annotates a matching member of a z.ZodObject literal', () => {
        const source = [
            'declare const c: {',
            '  readonly responses: {',
            '    readonly 201: z.ZodObject<{',
            '      image_id: z.ZodString;',
            '      mediaId: z.ZodString;',
            '    }, z.core.$strip>;',
            '  };',
            '};',
            '',
        ].join('\n');

        const result = injectDeprecatedTags(source, names);

        expect(result).toContain('@deprecated Use `image_id` instead.');
        expect(result).toMatch(/@deprecated Use `image_id` instead\.\n\s+\*\/\n\s+mediaId: z\.ZodString;/);
        expect(result).not.toMatch(/@deprecated[\s\S]*image_id: z\.ZodString/);
    });

    test('emits a bare @deprecated when the message is empty', () => {
        const source = ['declare const c: z.ZodObject<{', '  email: z.ZodString;', '}, z.core.$strip>;', ''].join('\n');

        const result = injectDeprecatedTags(source, names);

        expect(result).toMatch(/\/\*\*\n\s+\* @deprecated\n\s+\*\/\n\s+email: z\.ZodString;/);
    });

    test('returns the source unchanged when there are no deprecated names', () => {
        const source = 'declare const c: z.ZodObject<{ email: z.ZodString; }, z.core.$strip>;\n';
        expect(injectDeprecatedTags(source, new Map())).toBe(source);
    });

    test('does not annotate a matching name outside a z.ZodObject literal', () => {
        const source = ['interface Options {', '  email: string;', '}', ''].join('\n');
        expect(injectDeprecatedTags(source, names)).toBe(source);
    });

    test('annotates members inside ZodOptional/ZodArray-wrapped ZodObjects', () => {
        const source = [
            'declare const c: {',
            '  readonly landscape: z.ZodOptional<z.ZodObject<{',
            '    media_id_unused: z.ZodString;',
            '    mediaId: z.ZodString;',
            '  }, z.core.$strip>>;',
            '  readonly gallery: z.ZodArray<z.ZodObject<{',
            '    mediaId: z.ZodString;',
            '  }, z.core.$strip>>;',
            '};',
            '',
        ].join('\n');

        const result = injectDeprecatedTags(source, names);

        expect(result.match(/@deprecated Use `image_id` instead\./g)?.length).toBe(2);
    });

    test('does not double-annotate a property that already has @deprecated', () => {
        const source = [
            'declare const c: z.ZodObject<{',
            '  /**',
            '   * @deprecated already here',
            '   */',
            '  mediaId: z.ZodString;',
            '}, z.core.$strip>;',
            '',
        ].join('\n');

        const result = injectDeprecatedTags(source, names);

        expect(result).toBe(source);
        expect(result.match(/@deprecated/g)?.length).toBe(1);
    });

    test('is idempotent across repeated runs', () => {
        const source = ['declare const c: z.ZodObject<{', '  mediaId: z.ZodString;', '}, z.core.$strip>;', ''].join('\n');

        const once = injectDeprecatedTags(source, names);
        const twice = injectDeprecatedTags(once, names);

        expect(twice).toBe(once);
    });
});
