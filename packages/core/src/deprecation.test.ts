import { describe, expect, test } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as url from 'node:url';
import { createDeprecationMap } from './deprecation.js';

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

describe('createDeprecationMap JSON cache', () => {
    test('writes a .deprecations.json and reads it back when the .ts is missing', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kizuna-deprecation-'));
        const fakeTsPath = path.join(tmpDir, 'contract.ts');
        const jsonPath = path.join(tmpDir, 'contract.deprecations.json');

        // First call: .ts exists → parses and writes .json cache
        const fromSource = createDeprecationMap(fixturePath);
        const cacheJsonPath = fixturePath.replace(/\.ts$/, '.deprecations.json');
        expect(fs.existsSync(cacheJsonPath)).toBe(true);

        // Copy only the .json to a directory with no .ts file
        fs.copyFileSync(cacheJsonPath, jsonPath);
        expect(fs.existsSync(fakeTsPath)).toBe(false);

        // Second call: .ts missing, .json present → loads from cache
        const fromCache = createDeprecationMap(fakeTsPath);

        expect(fromCache.routes.get('oldRoute')).toBe(fromSource.routes.get('oldRoute'));
        expect(fromCache.fields.get('getUser')?.get('responses.200.email')).toBe(
            fromSource.fields.get('getUser')?.get('responses.200.email')
        );
        expect(fromCache.fields.get('newRoute')?.get('body.name')).toBe(fromSource.fields.get('newRoute')?.get('body.name'));

        fs.rmSync(tmpDir, {
            recursive: true,
        });
    });

    test('throws when neither .ts nor .json exist', () => {
        expect(() => createDeprecationMap('/nonexistent/contract.ts')).toThrow(
            'Deprecation contract not found: "/nonexistent/contract.ts"'
        );
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
