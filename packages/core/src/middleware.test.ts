import { describe, expect, it } from 'vitest';
import { resolveMiddleware } from './middleware.js';

const dummyA = () => 'a';
const dummyB = () => 'b';
const dummyC = () => 'c';

describe('resolveMiddleware', () => {
    it('returns empty array when map is undefined', () => {
        expect(resolveMiddleware('foo', undefined)).toEqual([]);
    });

    it('resolves a top-level route key to its middleware array', () => {
        expect(
            resolveMiddleware('getUser', {
                getUser: [dummyA],
            })
        ).toEqual([dummyA]);
    });

    it('resolves a nested route key through a group', () => {
        expect(
            resolveMiddleware('users.getUser', {
                users: {
                    getUser: [dummyA, dummyB],
                },
            })
        ).toEqual([dummyA, dummyB]);
    });

    it('applies group-level array to all routes in the group', () => {
        const map = {
            users: [dummyA],
        };
        expect(resolveMiddleware('users.getUser', map)).toEqual([dummyA]);
        expect(resolveMiddleware('users.createUser', map)).toEqual([dummyA]);
    });

    it('returns empty array when key is not in the map', () => {
        expect(
            resolveMiddleware('health', {
                users: [dummyA],
            })
        ).toEqual([]);
    });

    it('returns empty array when nested key is not in the map', () => {
        expect(
            resolveMiddleware('users.deleteUser', {
                users: {
                    getUser: [dummyA],
                },
            })
        ).toEqual([]);
    });

    it('resolves deeply nested route keys', () => {
        expect(
            resolveMiddleware('api.users.getUser', {
                api: {
                    users: {
                        getUser: [dummyC],
                    },
                },
            })
        ).toEqual([dummyC]);
    });

    it('stops at the first array encountered in a group chain', () => {
        expect(
            resolveMiddleware('api.users.getUser', {
                api: [dummyA],
            })
        ).toEqual([dummyA]);
    });
});
