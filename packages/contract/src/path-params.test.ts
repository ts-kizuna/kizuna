import { describe, expect, it } from 'vitest';
import { buildPath } from './path-params.js';
import { Kizuna } from '@ts-kizuna/contract';

describe('buildPath', () => {
    it('returns the path as-is when no params given', () => {
        expect(buildPath('/users')).toBe('/users');
    });

    it('replaces a single path parameter', () => {
        expect(
            buildPath('/users/:id', {
                id: '123',
            })
        ).toBe('/users/123');
    });

    it('replaces multiple path parameters', () => {
        expect(
            buildPath('/users/:userId/posts/:postId', {
                userId: '1',
                postId: '2',
            })
        ).toBe('/users/1/posts/2');
    });

    it('coerces numeric params to strings', () => {
        expect(
            buildPath('/users/:id', {
                id: 42,
            })
        ).toBe('/users/42');
    });

    it('url-encodes parameter values', () => {
        expect(
            buildPath('/users/:id', {
                id: 'a b/c',
            })
        ).toBe('/users/a%20b%2Fc');
    });

    it('throws when a required param is missing', () => {
        expect(() =>
            buildPath('/users/:id', {
                other: 'x',
            })
        ).toThrow(/Missing path parameter: id/);
    });
});
