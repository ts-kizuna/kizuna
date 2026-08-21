import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import { AUTHORING_NAMES } from '@ts-kizuna/core/authoring-names';

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
        if (isContractChainCall(node) || isRoutesChainCall(node)) {
            const routesArg = routesArgFrom(node);
            if (routesArg) return firstObjectLiteralIn(routesArg, resolve, visited);
            return undefined;
        }
        if (isModelCall(node)) {
            const modelSchema = extractCreateModelSchema(node);
            return modelSchema ? firstObjectLiteralIn(modelSchema, resolve, visited) : undefined;
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
// base expression, enabling documented fields from the base schema to be collected.
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
    if (!ts.isCallExpression(node) || !isModelCall(node)) return undefined;
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
 * and its property node. Resolves identifiers, `Kizuna.model`, generic wrapper
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

/**
 * True when `node` calls `member` on any receiver, e.g. `k.routes(...)`.
 */
const isMemberCall = (node: ts.CallExpression, member: string): boolean =>
    ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.name) && node.expression.name.text === member;

const isRoutesChainCall = (node: ts.CallExpression): boolean => isMemberCall(node, AUTHORING_NAMES.routes);

const isContractChainCall = (node: ts.CallExpression): boolean => isMemberCall(node, AUTHORING_NAMES.contract);

const isModelCall = (node: ts.CallExpression): boolean => isMemberCall(node, AUTHORING_NAMES.model);

const routesArgFrom = (call: ts.CallExpression): ts.Expression | undefined => {
    // k.routes(tag, routes) | k.routes(routes), the route map is the final argument.
    if (isRoutesChainCall(call)) return call.arguments[call.arguments.length - 1];
    // k.contract({ routes: X }), unwrap the `routes` property so the walker sees the
    // route map, not the `{ routes, validation }` wrapper.
    if (isContractChainCall(call)) {
        const arg = call.arguments[0];
        if (arg && ts.isObjectLiteralExpression(arg)) {
            for (const prop of arg.properties) {
                if (ts.isPropertyAssignment(prop) && propertyName(prop.name) === 'routes') return prop.initializer;
                if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === 'routes') return prop.name;
            }
        }
        return arg;
    }
    const firstArg = call.arguments[0];
    if (!firstArg) return undefined;
    if (call.arguments.length === 2) return call.arguments[1];
    return firstArg;
};

export { collectExportedSchemaDocs } from './schema-exports.js';
export { patchDeclarationDocs, type PatchResult } from './dts-jsdoc.js';
