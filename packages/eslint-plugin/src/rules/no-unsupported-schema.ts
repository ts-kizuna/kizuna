import * as path from 'node:path';
import { ESLintUtils } from '@typescript-eslint/utils';
import ts from 'typescript';
import { collectSchemaIssues, type SchemaIssue, type SchemaResolver } from '../schema-violations.js';
import { schemaNodesOf } from '../contract-nodes.js';

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
} as const satisfies Record<SchemaIssue, readonly [string, string]>;

export const noUnsupportedSchema = ESLintUtils.RuleCreator.withoutDocs({
    meta: {
        type: 'problem',
        docs: {
            description:
                'Disallow constructs unsupported by ts-kizuna (z.coerce, @deprecated with JSDoc inline tags) in contract and model schemas, including imported ones.',
        },
        messages: {
            coerce: 'z.coerce is not supported in a ts-kizuna schema. kizuna coerces query, path, and header params automatically — use z.number(), z.date(), or z.bigint() instead.',
            jsdocTag:
                'This @deprecated message uses JSDoc inline tags like {@link}. kizuna surfaces deprecation text verbatim to generated clients that cannot parse it — use plain text instead (backticks are fine).',
            coerceReference:
                'This schema uses z.coerce, which ts-kizuna does not support. kizuna coerces query, path, and header params automatically — use z.number(), z.date(), or z.bigint() instead.',
            jsdocTagReference:
                'This schema has a @deprecated message with JSDoc inline tags like {@link}. kizuna surfaces deprecation text verbatim to generated clients that cannot parse it — use plain text instead (backticks are fine).',
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
