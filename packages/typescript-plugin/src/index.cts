import type * as TypeScriptNamespace from 'typescript';

type TypeScriptModule = typeof TypeScriptNamespace;

interface Deprecation {
    message: string | undefined;
}

/**
 * TypeScript's own "is deprecated" code, so editors render these natively.
 */
const DEPRECATED_CODE = 6385;

function init(modules: { typescript: TypeScriptModule }): {
    create: (info: TypeScriptNamespace.server.PluginCreateInfo) => TypeScriptNamespace.LanguageService;
} {
    const typescript = modules.typescript;

    const findProperty = (
        object: TypeScriptNamespace.ObjectLiteralExpression,
        name: string
    ): TypeScriptNamespace.PropertyAssignment | undefined => {
        for (const property of object.properties) {
            if (!typescript.isPropertyAssignment(property)) continue;
            if (typescript.isIdentifier(property.name) && property.name.text === name) return property;
            if (typescript.isStringLiteral(property.name) && property.name.text === name) return property;
        }
        return undefined;
    };

    /**
     * Reads a `deprecated` value in every form the contract accepts: `true`, a
     * message, or `{ message?, date?, link? }`. A form without a message still
     * deprecates, it just has nothing to say.
     */
    const declaredDeprecation = (expression: TypeScriptNamespace.Expression): Deprecation | undefined => {
        if (expression.kind === typescript.SyntaxKind.TrueKeyword) {
            return {
                message: undefined,
            };
        }
        if (typescript.isStringLiteral(expression)) {
            return {
                message: expression.text,
            };
        }
        if (typescript.isObjectLiteralExpression(expression)) {
            const messageProperty = findProperty(expression, 'message');
            const message =
                messageProperty && typescript.isStringLiteral(messageProperty.initializer) ? messageProperty.initializer.text : undefined;
            return {
                message,
            };
        }
        return undefined;
    };

    const metaObjectDeprecation = (meta: TypeScriptNamespace.ObjectLiteralExpression): Deprecation | undefined => {
        const deprecatedProperty = findProperty(meta, 'deprecated');
        return deprecatedProperty ? declaredDeprecation(deprecatedProperty.initializer) : undefined;
    };

    const metaChainDeprecation = (expression: TypeScriptNamespace.Expression): Deprecation | undefined => {
        let current: TypeScriptNamespace.Expression = expression;
        while (typescript.isCallExpression(current) && typescript.isPropertyAccessExpression(current.expression)) {
            if (current.expression.name.text === 'meta') {
                const argument = current.arguments[0];
                if (argument && typescript.isObjectLiteralExpression(argument)) {
                    const found = metaObjectDeprecation(argument);
                    if (found) return found;
                }
            }
            current = current.expression.expression;
        }
        return undefined;
    };

    const declarationDeprecation = (declaration: TypeScriptNamespace.Declaration): Deprecation | undefined => {
        if (!typescript.isPropertyAssignment(declaration)) return undefined;
        const initializer = declaration.initializer;
        if (typescript.isObjectLiteralExpression(initializer)) {
            if (!findProperty(initializer, 'method')) return undefined;
            const deprecatedProperty = findProperty(initializer, 'deprecated');
            return deprecatedProperty ? declaredDeprecation(deprecatedProperty.initializer) : undefined;
        }
        return metaChainDeprecation(initializer);
    };

    /**
     * Transient symbols on mapped and inferred types point at their authored
     * declaration through the internal `target`.
     */
    const resolveTargetSymbol = (symbol: TypeScriptNamespace.Symbol): TypeScriptNamespace.Symbol => {
        let current = symbol;
        const seen = new Set<TypeScriptNamespace.Symbol>();
        while (!seen.has(current)) {
            seen.add(current);
            const target = (current as { target?: TypeScriptNamespace.Symbol }).target;
            if (!target) break;
            current = target;
        }
        return current;
    };

    const symbolDeprecation = (symbol: TypeScriptNamespace.Symbol | undefined): Deprecation | undefined => {
        if (!symbol) return undefined;
        for (const candidate of [symbol, resolveTargetSymbol(symbol)]) {
            for (const declaration of candidate.getDeclarations() ?? []) {
                const found = declarationDeprecation(declaration);
                if (found) return found;
            }
        }
        return undefined;
    };

    const nodeAt = (node: TypeScriptNamespace.Node, position: number): TypeScriptNamespace.Node => {
        let match: TypeScriptNamespace.Node | undefined;
        node.forEachChild((child) => {
            if (!match && position >= child.getStart() && position < child.getEnd()) match = child;
        });
        return match ? nodeAt(match, position) : node;
    };

    const propertyAccessAt = (
        sourceFile: TypeScriptNamespace.SourceFile,
        position: number
    ): TypeScriptNamespace.PropertyAccessExpression | undefined => {
        for (const candidate of [position, position - 1]) {
            if (candidate < 0) continue;
            let current: TypeScriptNamespace.Node | undefined = nodeAt(sourceFile, candidate);
            while (current && !typescript.isPropertyAccessExpression(current)) current = current.parent;
            if (current) return current;
        }
        return undefined;
    };

            const create = (info: TypeScriptNamespace.server.PluginCreateInfo): TypeScriptNamespace.LanguageService => {
        const languageService = info.languageService;

        const members = Object.create(null) as Record<string, unknown>;
        for (const key of Object.keys(languageService)) {
            const member = (languageService as unknown as Record<string, unknown>)[key];
            members[key] =
                typeof member === 'function' ? (member as (...callArguments: unknown[]) => unknown).bind(languageService) : member;
        }
        const proxy = members as unknown as TypeScriptNamespace.LanguageService;

        // Sticky per project: a new ts-kizuna install needs a TS server restart.
        let kizunaProject: boolean | undefined;
        const isKizunaProject = (program: TypeScriptNamespace.Program): boolean => {
            if (kizunaProject === undefined) {
                kizunaProject = program
                    .getSourceFiles()
                    .some((file) => file.fileName.includes('@ts-kizuna/') || file.text.includes('ts-kizuna'));
            }
            return kizunaProject;
        };

        const fileContext = (
            fileName: string
        ): { sourceFile: TypeScriptNamespace.SourceFile; checker: TypeScriptNamespace.TypeChecker } | undefined => {
            const program = languageService.getProgram();
            const sourceFile = program?.getSourceFile(fileName);
            if (!program || !sourceFile) return undefined;
            if (!isKizunaProject(program)) return undefined;
            return {
                sourceFile,
                checker: program.getTypeChecker(),
            };
        };

        proxy.getSuggestionDiagnostics = (fileName) => {
            const prior = languageService.getSuggestionDiagnostics(fileName);
            const context = fileContext(fileName);
            if (!context) return prior;
            const extra: TypeScriptNamespace.DiagnosticWithLocation[] = [];
            const visit = (node: TypeScriptNamespace.Node): void => {
                if (typescript.isPropertyAccessExpression(node)) {
                    const deprecation = symbolDeprecation(context.checker.getSymbolAtLocation(node.name));
                    if (deprecation) {
                        extra.push({
                            file: context.sourceFile,
                            start: node.name.getStart(context.sourceFile),
                            length: node.name.getWidth(context.sourceFile),
                            messageText: deprecation.message
                                ? `'${node.name.text}' is deprecated. ${deprecation.message}`
                                : `'${node.name.text}' is deprecated.`,
                            category: typescript.DiagnosticCategory.Suggestion,
                            code: DEPRECATED_CODE,
                            reportsDeprecated: true,
                        });
                    }
                }
                typescript.forEachChild(node, visit);
            };
            visit(context.sourceFile);
            // Loaded twice (tsconfig plus extension), the inner instance already reported these.
            const fresh = extra.filter(
                (candidate) => !prior.some((existing) => existing.start === candidate.start && existing.code === candidate.code)
            );
            return [...prior, ...fresh];
        };

        proxy.getQuickInfoAtPosition = (fileName, position) => {
            const prior = languageService.getQuickInfoAtPosition(fileName, position);
            if (!prior) return prior;
            const context = fileContext(fileName);
            if (!context) return prior;
            const node = nodeAt(context.sourceFile, position);
            if (!typescript.isIdentifier(node)) return prior;
            const deprecation = symbolDeprecation(context.checker.getSymbolAtLocation(node));
            if (!deprecation) return prior;
            if (prior.tags?.some((candidate) => candidate.name === 'deprecated')) return prior;
            const tag: TypeScriptNamespace.JSDocTagInfo = {
                name: 'deprecated',
                text: deprecation.message
                    ? [
                          {
                              kind: 'text',
                              text: deprecation.message,
                          },
                      ]
                    : [],
            };
            return {
                ...prior,
                tags: [...(prior.tags ?? []), tag],
            };
        };

        proxy.getCompletionsAtPosition = (fileName, position, options, formattingSettings) => {
            const prior = languageService.getCompletionsAtPosition(fileName, position, options, formattingSettings);
            if (!prior) return prior;
            const context = fileContext(fileName);
            if (!context) return prior;
            const access = propertyAccessAt(context.sourceFile, position);
            if (!access) return prior;
            const receiverType = context.checker.getTypeAtLocation(access.expression);
            for (const entry of prior.entries) {
                if (entry.kindModifiers?.includes('deprecated')) continue;
                const deprecation = symbolDeprecation(receiverType.getProperty(entry.name));
                if (!deprecation) continue;
                entry.kindModifiers = entry.kindModifiers ? `${entry.kindModifiers},deprecated` : 'deprecated';
            }
            return prior;
        };

        return proxy;
    };

    return {
        create,
    };
}

export = init;
