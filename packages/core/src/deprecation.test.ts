import { describe, expect, test } from 'vitest';
import * as path from 'node:path';
import * as url from 'node:url';
import { createDeprecationMap, serializeDeprecationMap, deserializeDeprecationMap, type DeprecationMap } from './deprecation.js';

const fixtureDir = path.dirname(url.fileURLToPath(import.meta.url));
const fixturePath = path.join(fixtureDir, 'deprecation.fixture.ts');

describe('createDeprecationMap', () => {
    const map = createDeprecationMap(fixturePath);

    test('records routes whose contract entry has @deprecated JSDoc', () => {
        expect(map.routes.has('oldRoute')).toBe(true);
        expect(map.routes.has('newRoute')).toBe(false);
    });

    test('captures the message after @deprecated for routes', () => {
        // `/** @deprecated use newRoute instead */` → message text is preserved verbatim.
        expect(map.routes.get('oldRoute')).toBe('use newRoute instead');
    });

    test('records an empty-string message for a bare @deprecated tag', () => {
        // The reused `UserSchema` carries `/** @deprecated */ email` with no comment text.
        expect(map.fields.get('getUser')?.get('responses.200.email')).toBe('');
    });

    test('records body fields whose Zod shape entry has @deprecated JSDoc', () => {
        expect(map.fields.get('newRoute')?.has('body.name')).toBe(true);
        expect(map.fields.get('newRoute')?.has('body.fullName')).toBe(false);
    });

    test('records query fields whose Zod shape entry has @deprecated JSDoc', () => {
        expect(map.fields.get('newRoute')?.has('query.page')).toBe(true);
        expect(map.fields.get('newRoute')?.has('query.cursor')).toBe(false);
    });

    test('follows same-file identifier references when a reused schema is the response', () => {
        // `getUser.responses[200] = UserSchema`, where `UserSchema` is a top-level const
        // in the same file with `/** @deprecated */ email`. The walk has to follow the
        // identifier to find the JSDoc.
        expect(map.fields.get('getUser')?.has('responses.200.email')).toBe(true);
    });

    test('follows same-file identifier references through array wrappers', () => {
        // `listUsers.responses[200].users = z.array(UserSchema)`.
        expect(map.fields.get('listUsers')?.has('responses.200.users.email')).toBe(true);
    });

    test('finds @deprecated fields inherited via .extend()', () => {
        expect(map.fields.get('getExtendedUser')?.has('responses.200.email')).toBe(true);
    });

    test('finds the exported contract even when a tagged sub-contract is defined earlier in the file', () => {
        expect(map.routes.size).toBeGreaterThan(0);
        expect(map.routes.has('oldRoute')).toBe(true);
    });

    test('follows generic wrapper functions to produce correct field paths', () => {
        // Paginated(UserSchema) returns { items: UserSchema[], total } — the deprecated
        // email field should appear at responses.200.items.email, not responses.200.email.
        expect(map.fields.get('listUsersPaginated')?.has('responses.200.items.email')).toBe(true);
        expect(map.fields.get('listUsersPaginated')?.has('responses.200.email')).toBe(false);
    });
});


describe('createDeprecationMap with createApi', () => {
    const map = createDeprecationMap(fixturePath);

    test('finds deprecated route inside a createApi routes object', () => {
        expect(map.routes.has('users.deleteUser')).toBe(true);
    });

    test('non-deprecated routes are absent', () => {
        expect(map.routes.has('users.listUsers')).toBe(false);
        expect(map.routes.has('users.getUser')).toBe(false);
        expect(map.routes.has('health.check')).toBe(false);
    });

    test('follows schema identifiers inside createApi routes for field deprecations', () => {
        // UserSchema has @deprecated email; getUser returns UserSchema
        expect(map.fields.get('users.getUser')?.has('responses.200.email')).toBe(true);
    });

    test('follows schema identifiers inside createApi routes through array wrappers', () => {
        // listUsers returns z.array(UserSchema)
        expect(map.fields.get('users.listUsers')?.has('responses.200.users.email')).toBe(true);
    });
});

describe('serializeDeprecationMap / deserializeDeprecationMap', () => {
    test('round-trips a deprecation map through JSON', () => {
        const original = createDeprecationMap(fixturePath);
        const serialized = serializeDeprecationMap(original);
        const json = JSON.parse(JSON.stringify(serialized));
        const restored = deserializeDeprecationMap(json);

        expect(restored.routes.get('oldRoute')).toBe(original.routes.get('oldRoute'));
        expect(restored.fields.get('getUser')?.get('responses.200.email')).toBe(
            original.fields.get('getUser')?.get('responses.200.email')
        );
        expect(restored.fields.get('newRoute')?.get('body.name')).toBe(
            original.fields.get('newRoute')?.get('body.name')
        );
    });

    test('serialized form contains plain objects, not Maps', () => {
        const original = createDeprecationMap(fixturePath);
        const serialized = serializeDeprecationMap(original);

        expect(serialized.routes).not.toBeInstanceOf(Map);
        expect(serialized.fields).not.toBeInstanceOf(Map);
    });

    test('round-trips schema-level deprecations', () => {
        const original = createDeprecationMap(fixturePath);
        if (original.schemas && original.schemas.size > 0) {
            const serialized = serializeDeprecationMap(original);
            const restored = deserializeDeprecationMap(serialized);
            for (const [schemaId, fieldMap] of original.schemas) {
                for (const [field, message] of fieldMap) {
                    expect(restored.schemas?.get(schemaId)?.get(field)).toBe(message);
                }
            }
        }
    });
});
