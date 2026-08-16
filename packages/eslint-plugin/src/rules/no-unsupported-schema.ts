import * as path from 'node:path';
import { ESLintUtils, type TSESTree } from '@typescript-eslint/utils';
import ts from 'typescript';
import { AUTHORING_NAMES } from '@ts-kizuna/shared/authoring-names';
import { collectSchemaIssues, type SchemaIssue, type SchemaResolver } from '../schema-violations.js';

const SCHEMA_KEYS: ReadonlySet<string> = new Set(['body', 'query', 'pathParams', 'headers']);

const createCheckerResolver =
    (checker: ts.TypeChecker): SchemaResolver =>
    (identifier) => {
        const symbol = checker.getSymbolAtLocation(identifier);
        if (!symbol) return undefined;
        const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
        return resolved.declarations?.find(ts.isVariableDeclaration)?.initializer;
    };

const createSourceResolver = (): SchemaResolver => {
    const sourceFileCache = new Map<string, ts.SourceFile | undefined>();
    const optionsCache = new Map<string, ts.CompilerOptions>();

    const readSourceFile = (fileName: string): ts.SourceFile | undefined => {
        if (sourceFileCache.has(fileName)) return sourceFileCache.get(fileName);
        const text = ts.sys.readFile(fileName);
        const sourceFile = text === undefined ? undefined : ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
        sourceFileCache.set(fileName, sourceFile);
        return sourceFile;
    };

    const compilerOptionsFor = (containingFile: string): ts.CompilerOptions => {
        const configPath = ts.findConfigFile(path.dirname(containingFile), ts.sys.fileExists);
        const key = configPath ?? '';
        const cached = optionsCache.get(key);
        if (cached) return cached;
        const options: ts.CompilerOptions = configPath
            ? ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, path.dirname(configPath)).options
            : { allowJs: true, moduleResolution: ts.ModuleResolutionKind.Bundler };
        optionsCache.set(key, options);
        return options;
    };

    const constNamed = (sourceFile: ts.SourceFile, name: string): ts.Expression | undefined => {
        for (const statement of sourceFile.statements) {
            if (!ts.isVariableStatement(statement)) continue;
            for (const declaration of statement.declarationList.declarations) {
                if (ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer)
                    return declaration.initializer;
            }
        }
        return undefined;
    };

    const importedFrom = (sourceFile: ts.SourceFile, name: string): { specifier: string; exportedName: string } | undefined => {
        for (const statement of sourceFile.statements) {
            if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
            const named = statement.importClause?.namedBindings;
            if (!named || !ts.isNamedImports(named)) continue;
            for (const element of named.elements) {
                if (element.name.text === name)
                    return {
                        specifier: statement.moduleSpecifier.text,
                        exportedName: (element.propertyName ?? element.name).text,
                    };
            }
        }
        return undefined;
    };

    return (identifier) => {
        const sourceFile = identifier.getSourceFile();
        const local = constNamed(sourceFile, identifier.text);
        if (local) return local;

        const imported = importedFrom(sourceFile, identifier.text);
        if (!imported) return undefined;

        const resolved = ts.resolveModuleName(imported.specifier, sourceFile.fileName, compilerOptionsFor(sourceFile.fileName), ts.sys)
            .resolvedModule?.resolvedFileName;
        if (!resolved) return undefined;

        const target = readSourceFile(resolved);
        return target ? constNamed(target, imported.exportedName) : undefined;
    };
};

const MESSAGE_IDS = {
    coerce: ['coerce', 'coerceReference'],
    'jsdoc-tag': ['jsdocTag', 'jsdocTagReference'],
    'duplicate-deprecated': ['duplicateDeprecated', 'duplicateDeprecatedReference'],
} as const satisfies Record<SchemaIssue, readonly [string, string]>;

const calleeName = (node: TSESTree.CallExpression): string | undefined => {
    const { callee } = node;
    if (callee.type === 'Identifier') return callee.name;
    if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') return callee.property.name;
    return undefined;
};

const schemaNodesOf = (call: TSESTree.CallExpression): TSESTree.Node[] => {
    const name = calleeName(call);
    if (name === AUTHORING_NAMES.model) {
        const config = call.arguments[0];
        if (config?.type !== 'ObjectExpression') return [];
        const schema = config.properties.find(
            (property): property is TSESTree.Property =>
                property.type === 'Property' && property.key.type === 'Identifier' && property.key.name === 'schema'
        );
        return schema ? [schema.value] : [];
    }

    if (name !== AUTHORING_NAMES.routes && name !== AUTHORING_NAMES.contract) return [];

    const nodes: TSESTree.Node[] = [];
    const visit = (node: TSESTree.Node): void => {
        if (node.type === 'Property') {
            const isSchemaField = node.key.type === 'Identifier' && SCHEMA_KEYS.has(node.key.name);
            const isStatusResponse = node.key.type === 'Literal' && typeof node.key.value === 'number';
            if (isSchemaField || isStatusResponse) nodes.push(node.value);
        }
        for (const [key, child] of Object.entries(node)) {
            if (key === 'parent') continue;
            if (Array.isArray(child)) child.forEach((item) => item?.type && visit(item));
            else if (child?.type) visit(child);
        }
    };
    for (const argument of call.arguments) visit(argument);
    return nodes;
};

export const noUnsupportedSchema = ESLintUtils.RuleCreator.withoutDocs({
    meta: {
        type: 'problem',
        docs: {
            description:
                'Disallow constructs unsupported by ts-kizuna (z.coerce, @deprecated with JSDoc tags) in contract and model schemas, including imported ones.',
        },
        messages: {
            coerce: 'z.coerce is not supported in a ts-kizuna schema. kizuna coerces query, path, and header params automatically, use z.number(), z.date(), or z.bigint() instead.',
            jsdocTag:
                'This @deprecated message uses JSDoc inline tags like {@link}. kizuna surfaces deprecation text verbatim to generated clients that cannot parse it, use plain text instead (backticks are fine).',
            duplicateDeprecated:
                'This field has more than one @deprecated tag. kizuna serializes only the first and silently drops the rest, collapse them into a single message.',
            coerceReference:
                'This schema uses z.coerce, which ts-kizuna does not support. kizuna coerces query, path, and header params automatically, use z.number(), z.date(), or z.bigint() instead.',
            jsdocTagReference:
                'This schema has a @deprecated message with JSDoc inline tags like {@link}. kizuna surfaces deprecation text verbatim to generated clients that cannot parse it, use plain text instead (backticks are fine).',
            duplicateDeprecatedReference:
                'This schema has a field with more than one @deprecated tag. kizuna serializes only the first and silently drops the rest, collapse them into a single message.',
        },
        schema: [],
    },
    defaultOptions: [],
    create(context) {
        const services = ESLintUtils.getParserServices(context, true);
        const resolve: SchemaResolver = services.program
            ? createCheckerResolver(services.program.getTypeChecker())
            : createSourceResolver();

        const reported = new Set<string>();

        return {
            CallExpression(call) {
                for (const schemaNode of schemaNodesOf(call)) {
                    const tsNode = services.esTreeNodeToTSNodeMap.get(schemaNode);
                    for (const { issue, node, viaReference } of collectSchemaIssues(tsNode, resolve)) {
                        const reportNode = (viaReference ? undefined : services.tsNodeToESTreeNodeMap.get(node)) ?? schemaNode;
                        const messageId = MESSAGE_IDS[issue][viaReference ? 1 : 0];
                        const key = `${messageId}@${reportNode.range[0]}`;
                        if (reported.has(key)) continue;
                        reported.add(key);
                        context.report({ node: reportNode, messageId });
                    }
                }
            },
        };
    },
});
