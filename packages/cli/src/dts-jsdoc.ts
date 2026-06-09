import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';

export interface PatchResult {
    filesScanned: number;
    filesChanged: number;
    injections: number;
}

/**
 * Zod wrapper types whose inner type is the first type argument. Navigating a
 * field path unwraps these until it reaches a `ZodObject`. Mirrors the runtime
 * wrapper set in `zod-internals.ts`.
 */
const ELEMENT_WRAPPERS: ReadonlySet<string> = new Set([
    'ZodArray',
    'ZodOptional',
    'ZodNullable',
    'ZodDefault',
    'ZodReadonly',
    'ZodNonOptional',
    'ZodCatch',
    'ZodPrefault',
]);

const entityNameRight = (name: ts.EntityName): string => (ts.isQualifiedName(name) ? name.right.text : name.text);

/**
 * The right-most type name, ignoring the qualifier — so `ZodObject`,
 * `z.ZodObject`, and `import("zod").ZodObject` all read as `ZodObject`.
 */
const rightmostTypeName = (node: ts.TypeNode): string | undefined => {
    if (ts.isTypeReferenceNode(node)) return entityNameRight(node.typeName);
    if (ts.isImportTypeNode(node)) return node.qualifier ? entityNameRight(node.qualifier) : undefined;
    return undefined;
};

const typeArgumentsOf = (node: ts.TypeNode): readonly ts.TypeNode[] => {
    if (ts.isTypeReferenceNode(node)) return node.typeArguments ?? [];
    if (ts.isImportTypeNode(node)) return node.typeArguments ?? [];
    return [];
};

const propertySignatureName = (node: ts.PropertyName): string | undefined => {
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isStringLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return node.text;
    return undefined;
};

/**
 * Walks a dotted field path through a Zod schema type to the leaf property
 * signature. Unwraps element wrappers (`ZodArray`, `ZodOptional`, …) and reads
 * each `ZodObject`'s shape from its first type argument. Returns undefined and
 * never throws when the path can't be navigated (e.g. the shape was emitted as
 * a named reference rather than a literal).
 */
const findPropertySignature = (typeNode: ts.TypeNode, segments: string[]): ts.PropertySignature | undefined => {
    let current: ts.TypeNode = typeNode;
    for (let index = 0; index < segments.length; index += 1) {
        let guard = 0;
        let name = rightmostTypeName(current);
        while (name !== undefined && ELEMENT_WRAPPERS.has(name)) {
            const args = typeArgumentsOf(current);
            if (args.length === 0) return undefined;
            current = args[0]!;
            name = rightmostTypeName(current);
            guard += 1;
            if (guard > 32) return undefined;
        }
        if (name !== 'ZodObject') return undefined;
        const shape = typeArgumentsOf(current)[0];
        if (!shape || !ts.isTypeLiteralNode(shape)) return undefined;
        const member = shape.members.find(
            (candidate): candidate is ts.PropertySignature =>
                ts.isPropertySignature(candidate) && propertySignatureName(candidate.name) === segments[index]
        );
        if (!member) return undefined;
        if (index === segments.length - 1) return member;
        if (!member.type) return undefined;
        current = member.type;
    }
    return undefined;
};

const hasLeadingJsDoc = (member: ts.Node, fullText: string): boolean => {
    const ranges = ts.getLeadingCommentRanges(fullText, member.getFullStart()) ?? [];
    return ranges.some((range) => fullText.slice(range.pos, range.pos + 3) === '/**');
};

/**
 * Re-indents a captured JSDoc block to `indent`: the opening `/**` keeps the
 * property's own indentation (already present before the splice point), and each
 * continuation line is re-prefixed so the `*` column lines up.
 */
const reindentJsDoc = (block: string, indent: string): string =>
    block
        .split('\n')
        .map((line, index) => (index === 0 ? line.trim() : `${indent} ${line.trim()}`))
        .join('\n');

const indentAt = (text: string, offset: number): string => {
    const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
    return text.slice(lineStart, offset).match(/^[ \t]*/)?.[0] ?? '';
};

/**
 * Maps each locally declared name to the names it's re-exported under in the
 * same file, e.g. `export { i as UserSchema }` from a bundled chunk where the
 * `declare const` is named `i`.
 */
const localExportAliases = (sourceFile: ts.SourceFile): Map<string, string[]> => {
    const aliases = new Map<string, string[]>();
    for (const statement of sourceFile.statements) {
        if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier) continue;
        if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
        for (const element of statement.exportClause.elements) {
            const localName = (element.propertyName ?? element.name).text;
            const list = aliases.get(localName) ?? [];
            list.push(element.name.text);
            aliases.set(localName, list);
        }
    }
    return aliases;
};

const patchFile = (filePath: string, exportFieldMap: Map<string, Map<string, string>>): number => {
    const text = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
    const aliases = localExportAliases(sourceFile);
    const insertions: Array<{ offset: number; text: string }> = [];

    for (const statement of sourceFile.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name) || !declaration.type) continue;
            const candidateNames = [declaration.name.text, ...(aliases.get(declaration.name.text) ?? [])];
            const fields = candidateNames.map((name) => exportFieldMap.get(name)).find(Boolean);
            if (!fields) continue;
            for (const [fieldPath, block] of fields) {
                const member = findPropertySignature(declaration.type, fieldPath.split('.'));
                if (!member || hasLeadingJsDoc(member, text)) continue;
                const offset = member.getStart(sourceFile);
                const indent = indentAt(text, offset);
                insertions.push({
                    offset,
                    text: `${reindentJsDoc(block, indent)}\n${indent}`,
                });
            }
        }
    }

    if (insertions.length === 0) return 0;
    insertions.sort((left, right) => right.offset - left.offset);
    let output = text;
    for (const insertion of insertions) {
        output = output.slice(0, insertion.offset) + insertion.text + output.slice(insertion.offset);
    }
    fs.writeFileSync(filePath, output, 'utf8');
    return insertions.length;
};

const DECLARATION_SUFFIXES = ['.d.ts', '.d.mts', '.d.cts'];

const walkDeclarationFiles = (dir: string, into: string[]): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walkDeclarationFiles(full, into);
        else if (entry.isFile() && DECLARATION_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) into.push(full);
    }
};

/**
 * Re-injects the JSDoc blocks from {@link collectExportedSchemaDocs} onto Zod
 * schema shape properties in the `.d.ts` files under `distDir`. Declaration emit
 * drops the comments an author wrote on schema fields; this restores them — full
 * descriptions, `@deprecated`, `@example`, etc. — so they reach `z.infer`
 * consumers in other repos. Skips properties that already have JSDoc. Idempotent.
 */
export const patchDeclarationDocs = (distDir: string, exportFieldMap: Map<string, Map<string, string>>): PatchResult => {
    const files: string[] = [];
    walkDeclarationFiles(distDir, files);
    let filesChanged = 0;
    let injections = 0;
    for (const file of files) {
        const count = patchFile(file, exportFieldMap);
        if (count > 0) {
            filesChanged += 1;
            injections += count;
        }
    }
    return {
        filesScanned: files.length,
        filesChanged,
        injections,
    };
};
