import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import { buildFileScope, collectFieldDocs, makeResolverWithCache, resolveImportPath } from './deprecation-parser.js';

/**
 * Maps every exported schema reachable from `entryPath` to the verbatim JSDoc
 * block on each of its fields, keyed by the exported const name (and, for
 * aliased re-exports, by the original declared name too).
 *
 * Walks the whole reachable graph, both the entry's re-exports and every file
 * it imports, so a schema defined in its own module and used via `import`
 * (rather than re-exported from the contract entry) is still collected.
 *
 * Used to patch emitted `.d.ts` files, where a `z.ZodObject<{...}>` shape is
 * keyed by the `declare const` name rather than a route or schema `meta.id`.
 */
export const collectExportedSchemaDocs = (entryPath: string): Map<string, Map<string, string>> => {
    const { resolve, cache } = makeResolverWithCache(entryPath);
    const result = new Map<string, Map<string, string>>();
    const visited = new Set<string>();

    const record = (name: string, expression: ts.Expression): void => {
        const fields = new Map<string, string>();
        collectFieldDocs(expression, '', fields, resolve);
        if (fields.size > 0) result.set(name, fields);
    };

    const collectFromFile = (filePath: string): void => {
        if (visited.has(filePath)) return;
        visited.add(filePath);
        const sourceFile = ts.createSourceFile(filePath, fs.readFileSync(filePath, 'utf8'), ts.ScriptTarget.Latest, true);

        for (const statement of sourceFile.statements) {
            if (ts.isVariableStatement(statement)) {
                const isExported = (statement.modifiers ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
                if (!isExported) continue;
                for (const declaration of statement.declarationList.declarations) {
                    if (ts.isIdentifier(declaration.name) && declaration.initializer) {
                        record(declaration.name.text, declaration.initializer);
                    }
                }
                continue;
            }

            if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier))
                continue;
            const specifier = statement.moduleSpecifier.text;
            if (!specifier.startsWith('.')) continue;
            const target = resolveImportPath(path.dirname(filePath), specifier);
            if (!target) continue;

            const exportClause = statement.exportClause;
            if (!exportClause) {
                // export * from './other.js', names are re-exported verbatim.
                collectFromFile(target);
                continue;
            }
            if (!ts.isNamedExports(exportClause)) continue;
            const targetScope = buildFileScope(target, cache);
            for (const element of exportClause.elements) {
                const localName = (element.propertyName ?? element.name).text;
                const exposedName = element.name.text;
                const expression = targetScope.get(localName);
                if (!expression) continue;
                record(exposedName, expression);
                if (localName !== exposedName) record(localName, expression);
            }
        }
    };

    collectFromFile(entryPath);
    // Also record exported consts from every import-reachable file, so schemas
    // imported (not re-exported through the entry) are still collected. The
    // resolver cache holds the full import graph after the entry walk above.
    for (const filePath of [...cache.keys()]) collectFromFile(filePath);
    return result;
};
