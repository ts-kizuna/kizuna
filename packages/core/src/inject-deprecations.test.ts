import { describe, expect, test } from 'vitest';
import { collectDeprecatedFieldNames } from './inject-deprecations.js';
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
