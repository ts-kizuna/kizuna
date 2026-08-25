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

    /**
     * Whether a call is `k.routes(...)` or a group accessor beneath it.
     */
    const isRoutesCall = (call: TypeScriptNamespace.CallExpression): boolean => {
        let current: TypeScriptNamespace.Node = call.expression;
        while (typescript.isPropertyAccessExpression(current)) {
            if (current.name.text === 'routes') return true;
            current = current.expression;
        }
        return false;
    };

    /**
     * The URL a route is served at, read off the type `k.routes` returns.
     * The group's `pathPrefix` is already composed into it there.
     */
    const resolvedRoutePath = (
        checker: TypeScriptNamespace.TypeChecker,
        pathProperty: TypeScriptNamespace.PropertyAssignment
    ): string | undefined => {
        const route = pathProperty.parent;
        if (!typescript.isObjectLiteralExpression(route)) return undefined;
        const entry = route.parent;
        if (!typescript.isPropertyAssignment(entry)) return undefined;
        const routes = entry.parent;
        if (!typescript.isObjectLiteralExpression(routes)) return undefined;
        const call = routes.parent;
        if (!typescript.isCallExpression(call) || !isRoutesCall(call)) return undefined;

        const declared = checker.getTypeAtLocation(call);
        const routeSymbol = checker.getPropertyOfType(declared, entry.name.getText());
        if (!routeSymbol) return undefined;
        const routeType = checker.getTypeOfSymbolAtLocation(routeSymbol, call);

        const pathSymbol = checker.getPropertyOfType(routeType, 'path');
        if (!pathSymbol) return undefined;
        const pathType = checker.getTypeOfSymbolAtLocation(pathSymbol, call);
        if (!pathType.isStringLiteral()) return undefined;

        return pathType.value;
    };

    const create = (info: TypeScriptNamespace.server.PluginCreateInfo): TypeScriptNamespace.LanguageService => {
        const languageService = info.languageService;

        // Declared in tsconfig beside the plugin name, so nothing has to be guessed.
        const baseUrl = typeof info.config?.baseUrl === 'string' ? info.config.baseUrl.replace(/\/$/, '') : '';

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

        proxy.provideInlayHints = (fileName, span, preferences) => {
            const prior = languageService.provideInlayHints(fileName, span, preferences);
            const context = fileContext(fileName);
            if (!context) return prior;

            const hints: TypeScriptNamespace.InlayHint[] = [];
            const visit = (node: TypeScriptNamespace.Node): void => {
                if (node.end >= span.start && node.pos <= span.start + span.length) {
                    if (typescript.isPropertyAssignment(node) && node.name.getText() === 'path') {
                        const resolved = resolvedRoutePath(context.checker, node);
                        // Nothing to add when the written path is already the URL.
                        const written = node.initializer.getText().replace(/^['"`]|['"`]$/g, '');
                        if (resolved !== undefined && !resolved.endsWith(` ${written}`)) {
                            hints.push({
                                text: `${baseUrl}${resolved}`,
                                position: node.end,
                                kind: typescript.InlayHintKind.Type,
                                whitespaceBefore: true,
                            });
                        }
                    }
                    node.forEachChild(visit);
                }
            };
            visit(context.sourceFile);

            return [...prior, ...hints];
        };

        return proxy;
    };

    return {
        create,
    };
}

export = init;
