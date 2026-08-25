import * as vscode from 'vscode';
import { readFileSync } from 'node:fs';
import * as ts from 'typescript';

/**
 * The URL each route resolves to, drawn beside its `path` as a pill.
 *
 * A trailing run of plain text reads as a comment, so the annotation carries
 * chrome instead: a background, a border and a radius mark it as injected.
 */
const pill = vscode.window.createTextEditorDecorationType({
    after: {
        margin: '0 0 0 8px',
        color: new vscode.ThemeColor('editor.foreground'),
        // A translucent grey reads the same on any theme, where a theme colour
        // often lands within a shade of the editor background.
        backgroundColor: 'rgba(127, 127, 127, 0.22)',
        // DecorationRenderOptions has no padding or radius, so smuggle them.
        textDecoration: 'none; padding: 1px 5px; border-radius: 4px; opacity: 0.9;',
    },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});

interface RouteUrl {
    range: vscode.Range;
    url: string;
}

const literal = (node: ts.Node | undefined): string | undefined =>
    node !== undefined && ts.isStringLiteralLike(node) ? node.text : undefined;

/**
 * A group's own prefix segment, and whether it starts from the root.
 */
const ownPrefix = (value: ts.Expression | undefined): { segment: string; absolute: boolean } => {
    const plain = literal(value);
    if (plain !== undefined) return { segment: plain, absolute: false };
    if (value !== undefined && ts.isObjectLiteralExpression(value)) {
        for (const property of value.properties) {
            if (ts.isPropertyAssignment(property) && property.name.getText() === 'absolute') {
                const absolute = literal(property.initializer);
                if (absolute !== undefined) return { segment: absolute, absolute: true };
            }
        }
    }
    return { segment: '', absolute: false };
};

const propertyOf = (object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined => {
    for (const property of object.properties) {
        if (ts.isPropertyAssignment(property) && property.name.getText() === name) return property.initializer;
    }
    return undefined;
};

/**
 * Every group's composed prefix, keyed by dotted path, read from a
 * `Kizuna.groups({ ... })` literal.
 */
const readGroups = (source: ts.SourceFile): Map<string, string> => {
    const prefixes = new Map<string, string>();

    const walk = (declared: ts.ObjectLiteralExpression, parentPath: string, inherited: string): void => {
        for (const property of declared.properties) {
            if (!ts.isPropertyAssignment(property)) continue;
            const key = property.name.getText().replace(/^['"`]|['"`]$/g, '');
            const path = parentPath === '' ? key : `${parentPath}.${key}`;
            const value = property.initializer;
            if (!ts.isObjectLiteralExpression(value)) {
                prefixes.set(path, inherited);
                continue;
            }
            const own = ownPrefix(propertyOf(value, 'pathPrefix'));
            const prefix = own.absolute ? own.segment : `${inherited}${own.segment}`;
            prefixes.set(path, prefix);
            const nested = propertyOf(value, 'groups');
            if (nested !== undefined && ts.isObjectLiteralExpression(nested)) walk(nested, path, prefix);
        }
    };

    const find = (node: ts.Node): void => {
        if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === 'groups' &&
            node.arguments[0] !== undefined &&
            ts.isObjectLiteralExpression(node.arguments[0])
        ) {
            walk(node.arguments[0], '', '');
        }
        node.forEachChild(find);
    };
    find(source);
    return prefixes;
};

/**
 * The dotted group path a `k.routes.workspace.members(...)` call declares into.
 */
const groupPathOf = (call: ts.CallExpression): string | undefined => {
    const segments: string[] = [];
    let current: ts.Node = call.expression;
    while (ts.isPropertyAccessExpression(current)) {
        segments.unshift(current.name.text);
        current = current.expression;
    }
    const routesAt = segments.indexOf('routes');
    return routesAt === -1 ? undefined : segments.slice(routesAt + 1).join('.');
};

const resolvePath = (prefix: string, written: string, absolute: boolean): string => {
    if (absolute) return written;
    if (prefix === '') return written;
    return written === '/' ? prefix : `${prefix}${written}`;
};

/**
 * Every route in the document with the URL it is served at.
 */
const routeUrls = (document: vscode.TextDocument, prefixes: Map<string, string>, baseUrl: string): RouteUrl[] => {
    const source = ts.createSourceFile(document.fileName, document.getText(), ts.ScriptTarget.Latest, true);
    const found: RouteUrl[] = [];

    const visitRoutes = (routes: ts.ObjectLiteralExpression, prefix: string): void => {
        for (const property of routes.properties) {
            if (!ts.isPropertyAssignment(property) || !ts.isObjectLiteralExpression(property.initializer)) continue;
            const route = property.initializer;
            const pathValue = propertyOf(route, 'path');
            if (pathValue === undefined) continue;

            const written = literal(pathValue);
            const escape = written === undefined ? ownPrefix(pathValue) : { segment: '', absolute: false };
            const value = written ?? escape.segment;
            if (value === '') continue;

            const url = resolvePath(prefix, value, escape.absolute);
            if (url === value && baseUrl === '') continue;
            const line = document.positionAt(pathValue.getStart(source)).line;
            found.push({
                range: document.lineAt(line).range,
                url: `${baseUrl}${url}`,
            });
        }
    };

    const find = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
            const groupPath = groupPathOf(node);
            const argument = node.arguments[0];
            if (groupPath !== undefined && argument !== undefined && ts.isObjectLiteralExpression(argument)) {
                visitRoutes(argument, prefixes.get(groupPath) ?? '');
            }
        }
        node.forEachChild(find);
    };
    find(source);
    return found;
};

/**
 * The group prefixes for a document, from the nearest `Kizuna.groups` in the workspace.
 */
const prefixesFor = async (): Promise<Map<string, string>> => {
    const files = await vscode.workspace.findFiles('**/{groups,tags}.ts', '**/node_modules/**', 5);
    for (const file of files) {
        try {
            const source = ts.createSourceFile(file.fsPath, readFileSync(file.fsPath, 'utf8'), ts.ScriptTarget.Latest, true);
            const prefixes = readGroups(source);
            if (prefixes.size > 0) return prefixes;
        } catch {
            // A file that will not parse simply contributes nothing.
        }
    }
    return new Map();
};

export const activate = (context: vscode.ExtensionContext): void => {
    let prefixes = new Map<string, string>();

    const reloadGroups = async (): Promise<void> => {
        prefixes = await prefixesFor();
        render(vscode.window.activeTextEditor);
    };

    const render = (editor: vscode.TextEditor | undefined): void => {
        if (editor === undefined || editor.document.languageId !== 'typescript') return;
        const settings = vscode.workspace.getConfiguration('tsKizuna.routeUrls');
        if (!settings.get<boolean>('enabled', true)) {
            editor.setDecorations(pill, []);
            return;
        }
        const baseUrl = settings.get<string>('baseUrl', '').replace(/\/$/, '');
        editor.setDecorations(
            pill,
            routeUrls(editor.document, prefixes, baseUrl).map(({ range, url }) => ({
                range,
                renderOptions: {
                    after: {
                        contentText: url,
                    },
                },
            }))
        );
    };

    const watcher = vscode.workspace.createFileSystemWatcher('**/{groups,tags}.ts');
    watcher.onDidChange(reloadGroups);
    watcher.onDidCreate(reloadGroups);

    context.subscriptions.push(
        pill,
        watcher,
        vscode.window.onDidChangeActiveTextEditor(render),
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document === vscode.window.activeTextEditor?.document) render(vscode.window.activeTextEditor);
        }),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('tsKizuna.routeUrls')) render(vscode.window.activeTextEditor);
        })
    );

    void reloadGroups();
};

export const deactivate = (): void => {};
