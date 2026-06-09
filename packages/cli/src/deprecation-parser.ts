import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import {
    type DeprecationMap,
    type SerializedDeprecationMap,
    type Contract,
    serializeDeprecationMap,
    contractFingerprint,
} from '@ts-kizuna/core/generator';

const SCHEMA_KEYS: ReadonlySet<string> = new Set(['body', 'query', 'headers']);

const readDeprecatedMessage = (node: ts.Node): string | undefined => {
    const tag = ts.getJSDocTags(node).find((candidate) => candidate.tagName.text === 'deprecated');
    if (!tag) return undefined;
    return ts.getTextOfJSDocComment(tag.comment) ?? '';
};

const propertyName = (node: ts.PropertyName): string | undefined => {
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isStringLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return node.text;
    return undefined;
};

export type Scope = Map<string, ts.Expression>;
export type IdentifierResolver = (node: ts.Identifier) => ts.Expression | undefined;

export const resolveImportPath = (dir: string, specifier: string): string | undefined => {
    const base = specifier.replace(/\.js$/, '');
    for (const candidate of [`${base}.ts`, `${base}/index.ts`, base]) {
        const full = path.resolve(dir, candidate);
        if (fs.existsSync(full)) return full;
    }
    return undefined;
};

// Build a per-file scope cache so that identifiers are always resolved against the scope of
// the file they came from. A flat merged scope breaks when expressions from file B reference
// names that were never imported into the root file A.
export const buildFileScope = (filePath: string, cache: Map<string, Scope>): Scope => {
    if (cache.has(filePath)) return cache.get(filePath)!;
    const scope: Scope = new Map();
    cache.set(filePath, scope); // set before recursing to break cycles

    const source = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);

    for (const statement of sourceFile.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const decl of statement.declarationList.declarations) {
            if (ts.isIdentifier(decl.name) && decl.initializer) {
                scope.set(decl.name.text, decl.initializer);
            }
        }
    }

    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement)) continue;
        if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const specifier = statement.moduleSpecifier.text;
        if (!specifier.startsWith('.')) continue;
        const importedPath = resolveImportPath(path.dirname(filePath), specifier);
        if (!importedPath) continue;
        const importedScope = buildFileScope(importedPath, cache);
        const namedBindings = statement.importClause?.namedBindings;
        if (!namedBindings || !ts.isNamedImports(namedBindings)) continue;
        for (const element of namedBindings.elements) {
            const exportedName = (element.propertyName ?? element.name).text;
            const localName = element.name.text;
            const expr = importedScope.get(exportedName);
            if (expr) scope.set(localName, expr);
        }
    }

    return scope;
};

export const makeResolverWithCache = (contractPath: string): { resolve: IdentifierResolver; cache: Map<string, Scope> } => {
    const cache = new Map<string, Scope>();
    buildFileScope(contractPath, cache);
    const resolve: IdentifierResolver = (node: ts.Identifier): ts.Expression | undefined => {
        const filePath = node.getSourceFile().fileName;
        const scope = cache.get(filePath) ?? buildFileScope(filePath, cache);
        return scope.get(node.text);
    };
    return { resolve, cache };
};

const readObjectStringProperty = (object: ts.ObjectLiteralExpression, name: string): string | undefined => {
    for (const property of object.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        if (!ts.isIdentifier(property.name) || property.name.text !== name) continue;
        if (ts.isStringLiteral(property.initializer)) return property.initializer.text;
    }
    return undefined;
};

const readAstMetaId = (expr: ts.Expression): string | undefined => {
    if (!ts.isCallExpression(expr)) return undefined;
    const firstArg = expr.arguments[0];

    if (ts.isIdentifier(expr.expression) && expr.expression.text === 'createModel') {
        if (!firstArg || !ts.isObjectLiteralExpression(firstArg)) return undefined;
        return readObjectStringProperty(firstArg, 'title');
    }

    if (ts.isPropertyAccessExpression(expr.expression) && expr.expression.name.text === 'meta') {
        if (!firstArg || !ts.isObjectLiteralExpression(firstArg)) return undefined;
        return readObjectStringProperty(firstArg, 'id') ?? readAstMetaId(expr.expression.expression as ts.Expression);
    }

    return undefined;
};

const firstObjectLiteralIn = (node: ts.Node, resolve: IdentifierResolver, visited: Set<string>): ts.ObjectLiteralExpression | undefined => {
    if (ts.isObjectLiteralExpression(node)) return node;
    if (ts.isIdentifier(node)) {
        const name = node.text;
        if (visited.has(name)) return undefined;
        const referenced = resolve(node);
        if (!referenced) return undefined;
        if (ts.isArrowFunction(referenced) || ts.isFunctionExpression(referenced)) return undefined;
        visited.add(name);
        return firstObjectLiteralIn(referenced, resolve, visited);
    }
    if (ts.isCallExpression(node)) {
        if (ts.isIdentifier(node.expression) && node.expression.text === 'createContract') {
            const routesArg = routesArgFrom(node);
            if (routesArg) return firstObjectLiteralIn(routesArg, resolve, visited);
            return undefined;
        }
        if (isRoutesChainCall(node)) {
            const routesArg = node.arguments[0];
            if (routesArg) return firstObjectLiteralIn(routesArg, resolve, visited);
            return undefined;
        }
    }
    let found: ts.ObjectLiteralExpression | undefined;
    ts.forEachChild(node, (child) => {
        if (found) return;
        found = firstObjectLiteralIn(child, resolve, visited);
    });
    return found;
};

// Walk past method chains (.meta, .optional, etc.) to find a .extend() call and return its
// base expression, enabling deprecated fields from the base schema to be collected.
const findExtendBase = (node: ts.Node): ts.Expression | undefined => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return undefined;
    if (node.expression.name.text === 'extend') return node.expression.expression;
    return findExtendBase(node.expression.expression);
};

// Return the body expression of an arrow function or function expression.
// For block bodies, finds the first return statement's expression.
const getFunctionBody = (func: ts.ArrowFunction | ts.FunctionExpression): ts.Node => {
    const { body } = func;
    if (!ts.isBlock(body)) return body;
    let result: ts.Expression | undefined;
    ts.forEachChild(body, (stmt) => {
        if (!result && ts.isReturnStatement(stmt) && stmt.expression) result = stmt.expression;
    });
    return result ?? body;
};

// Build a resolver that substitutes function parameters with call arguments,
// falling back to the parent resolver for everything else.
const makeScopedResolver = (
    func: ts.ArrowFunction | ts.FunctionExpression,
    args: ts.NodeArray<ts.Expression>,
    parent: IdentifierResolver
): IdentifierResolver => {
    const substitutions = new Map<string, ts.Expression>();
    func.parameters.forEach((param, index) => {
        const arg = args[index];
        if (arg && ts.isIdentifier(param.name)) substitutions.set(param.name.text, arg);
    });
    return (node: ts.Identifier): ts.Expression | undefined => substitutions.get(node.text) ?? parent(node);
};

const extractCreateModelSchema = (node: ts.Node): ts.Expression | undefined => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return undefined;
    if (node.expression.text !== 'createModel') return undefined;
    const firstArg = node.arguments[0];
    if (!firstArg || !ts.isObjectLiteralExpression(firstArg)) return undefined;
    for (const property of firstArg.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        if (propertyName(property.name) === 'schema') return property.initializer;
    }
    return undefined;
};

/**
 * Walks a schema expression's fields, calling `visit` with each field's dot-path
 * and its property node. Resolves identifiers, `createModel`, generic wrapper
 * functions (e.g. `Pagination(Item)`), and `.extend()`; recurses into nested
 * objects.
 */
export const walkSchemaFields = (
    schemaNode: ts.Node,
    prefix: string,
    resolve: IdentifierResolver,
    visit: (fieldPath: string, property: ts.ObjectLiteralElementLike) => void
): void => {
    const resolved = ts.isIdentifier(schemaNode) ? (resolve(schemaNode) ?? schemaNode) : schemaNode;

    const modelSchema = extractCreateModelSchema(resolved);
    if (modelSchema) {
        walkSchemaFields(modelSchema, prefix, resolve, visit);
        return;
    }

    if (ts.isCallExpression(resolved) && ts.isIdentifier(resolved.expression)) {
        const funcExpr = resolve(resolved.expression);
        if (funcExpr && (ts.isArrowFunction(funcExpr) || ts.isFunctionExpression(funcExpr))) {
            walkSchemaFields(getFunctionBody(funcExpr), prefix, makeScopedResolver(funcExpr, resolved.arguments, resolve), visit);
            return;
        }
    }

    const extendBase = findExtendBase(resolved);
    if (extendBase) walkSchemaFields(extendBase, prefix, resolve, visit);

    const objectLiteral = firstObjectLiteralIn(schemaNode, resolve, new Set());
    if (!objectLiteral) return;
    for (const property of objectLiteral.properties) {
        if (ts.isShorthandPropertyAssignment(property)) {
            visit(prefix === '' ? property.name.text : `${prefix}.${property.name.text}`, property);
            continue;
        }
        if (!ts.isPropertyAssignment(property)) continue;
        const fieldName = propertyName(property.name);
        if (fieldName === undefined) continue;
        const fieldPath = prefix === '' ? fieldName : `${prefix}.${fieldName}`;
        visit(fieldPath, property);
        walkSchemaFields(property.initializer, fieldPath, resolve, visit);
    }
};

export const collectFieldDeprecations = (
    schemaNode: ts.Node,
    prefix: string,
    into: Map<string, string>,
    resolve: IdentifierResolver
): void => {
    walkSchemaFields(schemaNode, prefix, resolve, (fieldPath, property) => {
        const message = readDeprecatedMessage(property);
        if (message !== undefined) into.set(fieldPath, message);
    });
};

/**
 * Returns the verbatim leading JSDoc block (`/** … *\/`) on a node, or undefined
 * when it has none.
 */
const readJsDocBlock = (node: ts.Node): string | undefined => {
    const sourceFile = node.getSourceFile();
    const ranges = ts.getLeadingCommentRanges(sourceFile.text, node.getFullStart()) ?? [];
    const jsDoc = ranges.filter((range) => sourceFile.text.slice(range.pos, range.pos + 3) === '/**').at(-1);
    return jsDoc ? sourceFile.text.slice(jsDoc.pos, jsDoc.end) : undefined;
};

export const collectFieldDocs = (schemaNode: ts.Node, prefix: string, into: Map<string, string>, resolve: IdentifierResolver): void => {
    walkSchemaFields(schemaNode, prefix, resolve, (fieldPath, property) => {
        const block = readJsDocBlock(property);
        if (block !== undefined) into.set(fieldPath, block);
    });
};

const isRouteLike = (obj: ts.ObjectLiteralExpression): boolean =>
    obj.properties.some((prop) => {
        const name = ts.isPropertyAssignment(prop)
            ? propertyName(prop.name)
            : ts.isShorthandPropertyAssignment(prop)
              ? prop.name.text
              : undefined;
        return name === 'method' || name === 'path' || name === 'responses';
    });

const routePropertyName = (prop: ts.ObjectLiteralElementLike): string | undefined => {
    if (ts.isPropertyAssignment(prop)) return propertyName(prop.name);
    if (ts.isShorthandPropertyAssignment(prop)) return prop.name.text;
    return undefined;
};

const routePropertyInitializer = (prop: ts.PropertyAssignment | ts.ShorthandPropertyAssignment): ts.Expression =>
    ts.isPropertyAssignment(prop) ? prop.initializer : prop.name;

const buildMapFromRoutesLiteral = (routesLiteral: ts.ObjectLiteralExpression, resolve: IdentifierResolver, prefix = ''): DeprecationMap => {
    const routes = new Map<string, string>();
    const fields = new Map<string, Map<string, string>>();
    for (const routeProperty of routesLiteral.properties) {
        if (!ts.isPropertyAssignment(routeProperty) && !ts.isShorthandPropertyAssignment(routeProperty)) continue;
        const routeName = routePropertyName(routeProperty);
        if (routeName === undefined) continue;
        const fullKey = prefix === '' ? routeName : `${prefix}.${routeName}`;

        const routeMessage = readDeprecatedMessage(routeProperty);
        if (routeMessage !== undefined) routes.set(fullKey, routeMessage);

        const initializer = routePropertyInitializer(routeProperty);
        const resolvedLiteral = ts.isObjectLiteralExpression(initializer)
            ? initializer
            : firstObjectLiteralIn(initializer, resolve, new Set());

        if (!resolvedLiteral) continue;

        if (!isRouteLike(resolvedLiteral)) {
            const sub = buildMapFromRoutesLiteral(resolvedLiteral, resolve, fullKey);
            for (const [key, value] of sub.routes) routes.set(key, value);
            for (const [key, value] of sub.fields) fields.set(key, value);
            continue;
        }

        const deprecated = new Map<string, string>();
        for (const subProperty of resolvedLiteral.properties) {
            if (!ts.isPropertyAssignment(subProperty)) continue;
            const subKey = propertyName(subProperty.name);
            if (subKey === undefined) continue;
            if (SCHEMA_KEYS.has(subKey)) {
                collectFieldDeprecations(subProperty.initializer, subKey, deprecated, resolve);
                continue;
            }
            if (subKey === 'responses' && ts.isObjectLiteralExpression(subProperty.initializer)) {
                for (const responseEntry of subProperty.initializer.properties) {
                    if (!ts.isPropertyAssignment(responseEntry)) continue;
                    const status = propertyName(responseEntry.name);
                    if (status === undefined) continue;
                    collectFieldDeprecations(responseEntry.initializer, `responses.${status}`, deprecated, resolve);
                }
            }
        }
        if (deprecated.size > 0) fields.set(fullKey, deprecated);
    }
    return {
        routes,
        fields,
    };
};

const findRouterCallInNode = (node: ts.Node): ts.CallExpression | undefined => {
    if (ts.isCallExpression(node)) {
        if (
            ts.isPropertyAccessExpression(node.expression) &&
            ts.isIdentifier(node.expression.name) &&
            node.expression.name.text === 'router'
        ) {
            return node;
        }
        if (ts.isIdentifier(node.expression) && node.expression.text === 'createContract') {
            return node;
        }
        if (isRoutesChainCall(node)) {
            return node;
        }
    }
    let found: ts.CallExpression | undefined;
    ts.forEachChild(node, (child) => {
        if (found) return;
        found = findRouterCallInNode(child);
    });
    return found;
};

const isRoutesChainCall = (node: ts.CallExpression): boolean =>
    ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.name) && node.expression.name.text === 'routes';

const routesArgFrom = (call: ts.CallExpression): ts.Expression | undefined => {
    if (isRoutesChainCall(call)) return call.arguments[0];
    const firstArg = call.arguments[0];
    if (!firstArg) return undefined;
    if (call.arguments.length === 2) return call.arguments[1];
    return firstArg;
};

const routesArgFromCreateApi = (call: ts.CallExpression): ts.Expression | undefined => {
    return call.arguments[0];
};

// Collects route object literals from all contract/api exports in the file.
// Handles both `createContract` and `createApi`, and follows `export { contract } from './other.js'` re-exports.
const collectExportedRoutesLiterals = (
    sourceFile: ts.SourceFile,
    resolve: IdentifierResolver,
    into: ts.ObjectLiteralExpression[]
): void => {
    for (const statement of sourceFile.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        const isExported = (statement.modifiers ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
        if (!isExported) continue;
        for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name)) continue;
            const exportName = declaration.name.text;
            if (exportName !== 'contract' && exportName !== 'api') continue;
            if (!declaration.initializer) continue;

            let initializer: ts.Expression = declaration.initializer;
            if (ts.isIdentifier(initializer)) {
                const resolved = resolve(initializer);
                if (resolved) initializer = resolved;
            }

            if (!ts.isCallExpression(initializer)) continue;
            const callee = initializer.expression;
            if (!ts.isIdentifier(callee)) continue;

            if (callee.text === 'createContract') {
                const routesArg = routesArgFrom(initializer);
                const lit = routesArg ? firstObjectLiteralIn(routesArg, resolve, new Set()) : undefined;
                if (lit) into.push(lit);
            } else if (callee.text === 'createApi') {
                const routesArg = routesArgFromCreateApi(initializer);
                const lit = routesArg ? firstObjectLiteralIn(routesArg, resolve, new Set()) : undefined;
                if (lit) into.push(lit);
            }
        }
    }

    for (const statement of sourceFile.statements) {
        if (!ts.isExportDeclaration(statement)) continue;
        if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const specifier = statement.moduleSpecifier.text;
        if (!specifier.startsWith('.')) continue;
        const exportClause = statement.exportClause;
        if (!exportClause || !ts.isNamedExports(exportClause)) continue;
        const hasContractExport = exportClause.elements.some((element) => {
            const exportedName = element.name.text;
            return exportedName === 'contract' || exportedName === 'api';
        });
        if (!hasContractExport) continue;
        const importedPath = resolveImportPath(path.dirname(sourceFile.fileName), specifier);
        if (!importedPath) continue;
        const importedSource = ts.createSourceFile(importedPath, fs.readFileSync(importedPath, 'utf8'), ts.ScriptTarget.Latest, true);
        collectExportedRoutesLiterals(importedSource, resolve, into);
    }
};

const findAllRouteObjectLiterals = (sourceFile: ts.SourceFile, resolve: IdentifierResolver): ts.ObjectLiteralExpression[] => {
    const results: ts.ObjectLiteralExpression[] = [];
    collectExportedRoutesLiterals(sourceFile, resolve, results);
    if (results.length > 0) return results;
    const routerCall = findRouterCallInNode(sourceFile);
    if (!routerCall) return [];
    const routesArg = routesArgFrom(routerCall);
    const lit = routesArg ? firstObjectLiteralIn(routesArg, resolve, new Set()) : undefined;
    return lit ? [lit] : [];
};

const parseFromSource = (contractPath: string): DeprecationMap => {
    const source = fs.readFileSync(contractPath, 'utf8');
    const sourceFile = ts.createSourceFile(contractPath, source, ts.ScriptTarget.Latest, true);
    const { resolve, cache } = makeResolverWithCache(contractPath);
    const routeLiterals = findAllRouteObjectLiterals(sourceFile, resolve);
    const routes = new Map<string, string>();
    const fields = new Map<string, Map<string, string>>();
    for (const literal of routeLiterals) {
        const partial = buildMapFromRoutesLiteral(literal, resolve);
        for (const [key, value] of partial.routes) routes.set(key, value);
        for (const [key, value] of partial.fields) fields.set(key, value);
    }

    const schemas = new Map<string, Map<string, string>>();
    for (const fileScope of cache.values()) {
        for (const expr of fileScope.values()) {
            const id = readAstMetaId(expr);
            if (!id) continue;
            const fieldDeprecations = new Map<string, string>();
            collectFieldDeprecations(expr, '', fieldDeprecations, resolve);
            if (fieldDeprecations.size > 0) schemas.set(id, fieldDeprecations);
        }
    }

    return { routes, fields, schemas };
};

export { collectExportedSchemaDocs } from './schema-exports.js';
export { patchDeclarationDocs, type PatchResult } from './dts-jsdoc.js';

/**
 * Parses a contract's `@deprecated` JSDoc tags into a {@link DeprecationMap}.
 */
export const createDeprecationMap = (contractPath: string): DeprecationMap => parseFromSource(contractPath);

export interface ContractSource {
    contract: Contract;
    contractPath: string;
}

/**
 * Parses each contract's `@deprecated` tags and writes them to
 * `<outDir>/deprecations.json`, keyed by contract fingerprint. Generators read
 * the entry matching the contract they generate. Returns the written path.
 */
export const writeKizunaDeprecations = (contracts: ContractSource[], outDir: string): string => {
    const entries: Record<string, SerializedDeprecationMap> = {};
    for (const { contract, contractPath } of contracts) {
        entries[contractFingerprint(contract)] = serializeDeprecationMap(createDeprecationMap(contractPath));
    }
    const outputPath = path.join(outDir, 'deprecations.json');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(entries, null, 2), 'utf8');
    return outputPath;
};
