import { describe, expect, test } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as url from 'node:url';
import { z } from 'zod';
import { Kizuna } from '@ts-kizuna/core';
import { loadJsDoc, contractFingerprint, serializeJsDocMap, deserializeJsDocMap } from '@ts-kizuna/core/generator';
import { createJsDocMap, writeKizunaJsDoc } from './jsdoc-parser.js';
import { parseJsDoc, parseExampleValue } from './jsdoc-block.js';
import { contract } from './contract.fixture.js';

const fixtureDir = path.dirname(url.fileURLToPath(import.meta.url));
const fixturePath = path.join(fixtureDir, 'contract.fixture.ts');

describe('createJsDocMap', () => {
    const map = createJsDocMap(fixturePath);

    test('records routes whose contract entry has @deprecated JSDoc', () => {
        expect(map.routes.get('oldRoute')?.deprecated).toBeDefined();
        expect(map.routes.get('newRoute')?.deprecated).toBeUndefined();
    });

    test('captures the message after @deprecated for routes', () => {
        // `/** @deprecated use newRoute instead */` → message text is preserved verbatim.
        expect(map.routes.get('oldRoute')?.deprecated).toBe('use newRoute instead');
    });

    test('records an empty-string message for a bare @deprecated tag', () => {
        // The reused `UserSchema` carries `/** @deprecated */ email` with no comment text.
        expect(map.fields.get('getUser')?.get('responses.200.email')?.deprecated).toBe('');
    });

    test('records body fields whose Zod shape entry has @deprecated JSDoc', () => {
        expect(map.fields.get('newRoute')?.get('body.name')?.deprecated).toBeDefined();
        expect(map.fields.get('newRoute')?.get('body.fullName')?.deprecated).toBeUndefined();
    });

    test('records query fields whose Zod shape entry has @deprecated JSDoc', () => {
        expect(map.fields.get('newRoute')?.get('query.page')?.deprecated).toBeDefined();
        expect(map.fields.get('newRoute')?.get('query.cursor')?.deprecated).toBeUndefined();
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

    test('unwraps a Kizuna.model reached through a wrapper, with no spurious `.schema.` segment', () => {
        // A `Kizuna.model` referenced via `z.array(...)`/`.optional()` must dive into its
        // `schema`, not treat the `{ title, schema }` argument's `schema` key as a field.
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kizuna-cm-'));
        const file = path.join(dir, 'contract.ts');
        fs.writeFileSync(
            file,
            `import { Kizuna, createContract } from '@ts-kizuna/core';
import { z } from 'zod';
const InnerModel = Kizuna.model({
    title: 'InnerModel',
    schema: z.object({
        id: z.string(),
        /** @deprecated */
        legacy: z.string(),
    }),
});
const OuterModel = Kizuna.model({
    title: 'OuterModel',
    schema: z.object({
        items: z.array(InnerModel),
    }),
});
export const contract = createContract({
    list: { method: 'GET', path: '/items', responses: { 200: OuterModel } },
});
`
        );
        const outer = createJsDocMap(file).schemas?.get('OuterModel');
        expect(outer?.has('items.legacy')).toBe(true);
        expect([...(outer?.keys() ?? [])].some((key) => key.includes('.schema.'))).toBe(false);
        fs.rmSync(dir, { recursive: true, force: true });
    });
});

describe('createJsDocMap descriptions and examples', () => {
    const map = createJsDocMap(fixturePath);

    test('reads a route description from its @description tag', () => {
        expect(map.routes.get('newRoute')?.description).toBe('Creates a user from the submitted name.');
    });

    test('reads @summary alongside @description', () => {
        const entry = map.routes.get('listUsersPaginated');
        expect(entry?.summary).toBe('List users, one page at a time.');
        expect(entry?.description).toBe('Pages are cursor-based, so a page boundary is stable while\nusers are being created.');
    });

    test('ignores prose that is not tagged', () => {
        expect(parseJsDoc('/**\n * Internal note for whoever reads this.\n */')).toBeUndefined();
    });

    test('reads field descriptions alongside @deprecated', () => {
        const entry = map.fields.get('newRoute')?.get('body.name');
        expect(entry?.description).toBe('The display name.');
        expect(entry?.deprecated).toBe('use fullName instead');
    });

    test('parses @example bodies into values', () => {
        expect(map.fields.get('newRoute')?.get('body.fullName')?.examples).toEqual(['Ada Lovelace']);
        expect(map.fields.get('newRoute')?.get('query.cursor')?.examples).toEqual(['eyJpZCI6IjQyIn0', 'eyJpZCI6Ijk5In0']);
    });

    test('parses an object @example into a value, not a string', () => {
        expect(map.routes.get('newRoute')?.examples).toEqual([
            {
                fullName: 'Ada Lovelace',
            },
        ]);
    });

    test('documents a response from JSDoc on the status key', () => {
        expect(map.fields.get('newRoute')?.get('responses.200')?.description).toBe('The user was created.');
    });

    test('documents path parameters', () => {
        expect(map.fields.get('getUserByIdV2')?.get('pathParams.id')?.description).toBe('The user id, as returned by listUsers.');
    });
});

describe('parseExampleValue', () => {
    test('keeps bare text as a string, so a plain example needs no quoting', () => {
        expect(parseExampleValue('Alice Johnson')).toBe('Alice Johnson');
        expect(parseExampleValue('alice@example.com')).toBe('alice@example.com');
        expect(parseExampleValue('+15551234567')).toBe('+15551234567');
    });

    test('reads a number, boolean, and null as themselves', () => {
        expect(parseExampleValue('42')).toBe(42);
        expect(parseExampleValue('-1.5')).toBe(-1.5);
        expect(parseExampleValue('true')).toBe(true);
        expect(parseExampleValue('null')).toBeNull();
    });

    test('quoting is how a string that looks like a number stays a string', () => {
        expect(parseExampleValue("'42'")).toBe('42');
    });

    test('reads object and array literals, with JSON or JavaScript keys', () => {
        expect(parseExampleValue("{ id: 'usr_1', active: true }")).toEqual({
            id: 'usr_1',
            active: true,
        });
        expect(parseExampleValue('{"id": "usr_1"}')).toEqual({
            id: 'usr_1',
        });
        expect(parseExampleValue("['a', 'b']")).toEqual(['a', 'b']);
    });

    test('unwraps a fenced code block, which is how examples read best on hover', () => {
        expect(parseExampleValue('```json\n{ "id": "usr_1" }\n```')).toEqual({
            id: 'usr_1',
        });
    });

    test('keeps anything that is not a literal as the text written', () => {
        expect(parseExampleValue('curl -X POST https://api.example.com/users')).toBe('curl -X POST https://api.example.com/users');
    });
});

describe('serializeJsDocMap / deserializeJsDocMap', () => {
    test('round-trips a JSDoc map through JSON', () => {
        const original = createJsDocMap(fixturePath);
        const serialized = serializeJsDocMap(original);
        const json = JSON.parse(JSON.stringify(serialized));
        const restored = deserializeJsDocMap(json);

        expect(restored.routes.get('oldRoute')).toEqual(original.routes.get('oldRoute'));
        expect(restored.fields.get('getUser')?.get('responses.200.email')).toEqual(
            original.fields.get('getUser')?.get('responses.200.email')
        );
        expect(restored.fields.get('newRoute')?.get('body.name')).toEqual(original.fields.get('newRoute')?.get('body.name'));
    });

    test('serialized form contains plain objects, not Maps', () => {
        const original = createJsDocMap(fixturePath);
        const serialized = serializeJsDocMap(original);

        expect(serialized.routes).not.toBeInstanceOf(Map);
        expect(serialized.fields).not.toBeInstanceOf(Map);
    });

    test('round-trips schema-level entries', () => {
        const original = createJsDocMap(fixturePath);
        if (original.schemas && original.schemas.size > 0) {
            const serialized = serializeJsDocMap(original);
            const restored = deserializeJsDocMap(serialized);
            for (const [schemaId, fieldMap] of original.schemas) {
                for (const [field, entry] of fieldMap) {
                    expect(restored.schemas?.get(schemaId)?.get(field)).toEqual(entry);
                }
            }
        }
    });
});

describe('loadJsDoc', () => {
    test('reads the entry for a contract by its fingerprint', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kizuna-'));
        writeKizunaJsDoc([{ contract, contractPath: fixturePath }], dir);
        const map = loadJsDoc(contractFingerprint(contract), dir);
        expect(map?.routes.get('oldRoute')?.deprecated).toBe('use newRoute instead');
        expect(map?.fields.get('getUser')?.has('responses.200.email')).toBe(true);
        expect(map?.schemas?.get('User')?.has('email')).toBe(true);
    });

    test('returns undefined for a contract not in the file', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kizuna-'));
        writeKizunaJsDoc([{ contract, contractPath: fixturePath }], dir);
        const k = new Kizuna({
            tags: Kizuna.tags({
                ping: 'Ping',
            }),
        });
        const pingRoutes = k.routes('ping', {
            ping: { method: 'GET', path: '/ping', responses: { 200: z.object({ ok: z.boolean() }) } },
        });
        const other = k.contract({
            routes: pingRoutes,
        });
        expect(loadJsDoc(contractFingerprint(other), dir)).toBeUndefined();
    });

    test('returns undefined when the file does not exist', () => {
        expect(loadJsDoc(contractFingerprint(contract), path.join(os.tmpdir(), 'kizuna-does-not-exist'))).toBeUndefined();
    });
});
