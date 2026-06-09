import { afterAll, describe, expect, test } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as url from 'node:url';
import ts from 'typescript';
import { collectExportedSchemaDocs, patchDeclarationDocs } from './deprecation-parser.js';

const packageDir = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const tempDirs: string[] = [];

const makeTempDir = (parent: string = os.tmpdir()): string => {
    const dir = fs.mkdtempSync(path.join(parent, 'kizuna-dts-'));
    tempDirs.push(dir);
    return dir;
};

afterAll(() => {
    for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const fieldMap = (entries: Record<string, Record<string, string>>): Map<string, Map<string, string>> =>
    new Map(Object.entries(entries).map(([name, fields]) => [name, new Map(Object.entries(fields))]));

const patchOne = (
    body: string,
    map: Map<string, Map<string, string>>,
    fileName = 'schema.d.mts'
): { dir: string; text: string; result: ReturnType<typeof patchDeclarationDocs> } => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, fileName), body, 'utf8');
    const result = patchDeclarationDocs(dir, map);
    return {
        dir,
        text: fs.readFileSync(path.join(dir, fileName), 'utf8'),
        result,
    };
};

describe('patchDeclarationDocs', () => {
    const userDts = `import { z } from "zod";
export declare const UserSchema: z.ZodObject<{
    id: z.ZodString;
    email: z.ZodString;
}, z.core.$strip>;
export type User = z.infer<typeof UserSchema>;
`;

    test('injects a single-line JSDoc block onto the matching property', () => {
        const { text, result } = patchOne(userDts, fieldMap({ UserSchema: { email: '/** @deprecated use email_address */' } }));
        expect(text).toContain('/** @deprecated use email_address */\n    email: z.ZodString;');
        expect(text).not.toMatch(/@deprecated[^\n]*\n\s*id:/);
        expect(text).toContain('}, z.core.$strip>;');
        expect(result.injections).toBe(1);
    });

    test('injects and re-indents a multi-line block', () => {
        const block = `/**\n * The user's email.\n * @example "a@b.com"\n * @deprecated use email_address\n */`;
        const { text } = patchOne(userDts, fieldMap({ UserSchema: { email: block } }));
        expect(text).toContain(
            [
                '    /**',
                "     * The user's email.",
                '     * @example "a@b.com"',
                '     * @deprecated use email_address',
                '     */',
                '    email: z.ZodString;',
            ].join('\n')
        );
    });

    test('skips a property that already has JSDoc (idempotent)', () => {
        const dir = makeTempDir();
        const file = path.join(dir, 'schema.d.mts');
        fs.writeFileSync(file, userDts, 'utf8');
        const map = fieldMap({ UserSchema: { email: '/** @deprecated x */' } });
        patchDeclarationDocs(dir, map);
        const afterFirst = fs.readFileSync(file, 'utf8');
        const second = patchDeclarationDocs(dir, map);
        expect(fs.readFileSync(file, 'utf8')).toBe(afterFirst);
        expect(second.injections).toBe(0);
        expect(afterFirst.match(/@deprecated/g)).toHaveLength(1);
    });

    test('navigates nested objects through optional wrappers', () => {
        const body = `import { z } from "zod";
export declare const AccountSchema: z.ZodObject<{
    address: z.ZodOptional<z.ZodObject<{
        city: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
`;
        const { text } = patchOne(body, fieldMap({ AccountSchema: { 'address.city': '/** @deprecated moved */' } }));
        expect(text).toContain('/** @deprecated moved */\n        city: z.ZodString;');
    });

    test('skips safely when the shape is an inlined named reference', () => {
        const body = `import { z } from "zod";
export declare const AccountSchema: z.ZodObject<{
    address: AddressSchema;
}, z.core.$strip>;
`;
        const { text, result } = patchOne(body, fieldMap({ AccountSchema: { 'address.city': '/** @deprecated moved */' } }));
        expect(text).not.toContain('@deprecated');
        expect(result.filesChanged).toBe(0);
    });

    test('matches a mangled chunk const through a local re-export alias', () => {
        const body = `import { z } from "zod";
declare const schema: z.ZodObject<{
    email: z.ZodString;
}, z.core.$strip>;
export { schema as UserSchema };
`;
        const { text } = patchOne(body, fieldMap({ UserSchema: { email: '/** @deprecated gone */' } }));
        expect(text).toContain('/** @deprecated gone */\n    email: z.ZodString;');
    });
});

describe('patched .d.ts restores full JSDoc through z.infer (language service)', () => {
    const inspectEmail = (declarationBody: string, block: string): { documentation: string; tags: string[]; deprecated: boolean } => {
        // Resolve from inside packageDir so `zod` is found via packages/cli/node_modules.
        const dir = makeTempDir(packageDir);
        fs.writeFileSync(path.join(dir, 'schema.d.ts'), declarationBody, 'utf8');
        patchDeclarationDocs(dir, fieldMap({ UserSchema: { email: block } }));
        const consumer = path.join(dir, 'consumer.ts');
        fs.writeFileSync(consumer, `import type { User } from './schema';\ndeclare const user: User;\nconst value = user.email;\n`, 'utf8');

        const settings: ts.CompilerOptions = {
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ESNext,
            strict: true,
            skipLibCheck: true,
        };
        const service = ts.createLanguageService({
            getScriptFileNames: () => [consumer],
            getScriptVersion: () => '1',
            getScriptSnapshot: (file) => {
                const content = ts.sys.readFile(file);
                return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content);
            },
            getCurrentDirectory: () => dir,
            getCompilationSettings: () => settings,
            getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
            fileExists: ts.sys.fileExists,
            readFile: ts.sys.readFile,
            readDirectory: ts.sys.readDirectory,
        });

        const text = fs.readFileSync(consumer, 'utf8');
        const position = text.lastIndexOf('user.email') + 'user.'.length;
        const quickInfo = service.getQuickInfoAtPosition(consumer, position);
        return {
            documentation: ts.displayPartsToString(quickInfo?.documentation),
            tags: (quickInfo?.tags ?? []).map((tag) => tag.name),
            deprecated: (quickInfo?.kindModifiers ?? '').includes('deprecated'),
        };
    };

    const userDts = `import { z } from "zod";
export declare const UserSchema: z.ZodObject<{
    id: z.ZodString;
    email: z.ZodString;
}, z.core.$strip>;
export type User = z.infer<typeof UserSchema>;
`;

    test('description, @example and @deprecated all reach the consumer', () => {
        const block = `/**\n * The user's email address.\n * @example "a@b.com"\n * @deprecated use email_address\n */`;
        const result = inspectEmail(userDts, block);
        expect(result.documentation).toBe("The user's email address.");
        expect(result.tags).toEqual(expect.arrayContaining(['example', 'deprecated']));
        expect(result.deprecated).toBe(true);
    });

    test('a description-only block carries docs without marking deprecated', () => {
        const result = inspectEmail(userDts, `/** The primary contact email. */`);
        expect(result.documentation).toBe('The primary contact email.');
        expect(result.deprecated).toBe(false);
    });
});

describe('collectExportedSchemaDocs', () => {
    const writeModule = (dir: string, name: string, body: string): string => {
        const file = path.join(dir, name);
        fs.writeFileSync(file, body, 'utf8');
        return file;
    };

    test('captures the verbatim JSDoc block keyed by exported const name', () => {
        const dir = makeTempDir();
        const entry = writeModule(
            dir,
            'schema.ts',
            `import { z } from "zod";
export const UserSchema = z.object({
    id: z.string(),
    /**
     * The email.
     * @deprecated use email_address
     */
    email: z.string(),
});
`
        );
        const docs = collectExportedSchemaDocs(entry);
        const block = docs.get('UserSchema')?.get('email');
        expect(block).toContain('@deprecated use email_address');
        expect(block).toContain('The email.');
        expect(docs.get('UserSchema')?.has('id')).toBe(false);
    });

    test('follows re-export aliases and keys by both names', () => {
        const dir = makeTempDir();
        writeModule(
            dir,
            'user.ts',
            `import { z } from "zod";
export const InternalUser = z.object({
    /** @deprecated */
    email: z.string(),
});
`
        );
        const entry = writeModule(dir, 'index.ts', `export { InternalUser as PublicUser } from './user.js';\n`);
        const docs = collectExportedSchemaDocs(entry);
        expect(docs.get('PublicUser')?.get('email')).toContain('@deprecated');
        expect(docs.get('InternalUser')?.get('email')).toContain('@deprecated');
    });
});
