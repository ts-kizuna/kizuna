import { describe, expect, test } from 'vitest';
import * as path from 'node:path';
import * as url from 'node:url';
import ts from 'typescript';

const fixtureDir = path.dirname(url.fileURLToPath(import.meta.url));
const fixturePath = path.resolve(fixtureDir, '../../core/src/deprecation.fixture.ts');

const program = ts.createProgram({
    rootNames: [fixturePath],
    options: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        strict: true,
        skipLibCheck: true,
        esModuleInterop: true,
        noEmit: true,
    },
});
const checker = program.getTypeChecker();
const fixtureSource = program.getSourceFile(fixturePath);
if (!fixtureSource) throw new Error(`could not load fixture: ${fixturePath}`);

const findExportType = (name: string): ts.Type => {
    const moduleSymbol = checker.getSymbolAtLocation(fixtureSource);
    if (!moduleSymbol) throw new Error('no module symbol for fixture');
    const exportSymbol = checker.getExportsOfModule(moduleSymbol).find((candidate) => candidate.getName() === name);
    if (!exportSymbol) throw new Error(`export ${name} not found`);
    return checker.getTypeOfSymbolAtLocation(exportSymbol, fixtureSource);
};

const propertyTags = (parent: ts.Type, key: string): readonly ts.JSDocTagInfo[] => {
    const property = parent.getProperty(key);
    if (!property) throw new Error(`no property ${key}`);
    return property.getJsDocTags(checker);
};

const hasDeprecated = (tags: readonly ts.JSDocTagInfo[]): boolean => tags.some((tag) => tag.name === 'deprecated');

const callArgsType = (clientType: ts.Type, route: string): ts.Type => {
    const routeSymbol = clientType.getProperty(route);
    if (!routeSymbol) throw new Error(`route ${route} missing on client`);
    const fnType = checker.getTypeOfSymbol(routeSymbol);
    const callSig = fnType.getCallSignatures()[0];
    if (!callSig) throw new Error(`route ${route} is not callable`);
    const argsParam = callSig.getParameters()[0];
    if (!argsParam) throw new Error(`route ${route} has no args param`);
    return checker.getTypeOfSymbol(argsParam);
};

describe('@deprecated propagation through Client<T>', () => {
    const clientType = findExportType('client');

    test('route-level @deprecated propagates to client method property', () => {
        expect(hasDeprecated(propertyTags(clientType, 'oldRoute'))).toBe(true);
    });

    test('non-deprecated routes do not get a @deprecated tag', () => {
        expect(hasDeprecated(propertyTags(clientType, 'newRoute'))).toBe(false);
    });

    test('field-level @deprecated on a body field propagates into client args', () => {
        const args = callArgsType(clientType, 'newRoute');
        const body = args.getProperty('body');
        if (!body) throw new Error('body missing');
        const bodyType = checker.getTypeOfSymbol(body);
        expect(hasDeprecated(propertyTags(bodyType, 'name'))).toBe(true);
    });

    test('field-level @deprecated on a query field propagates into client args', () => {
        const args = callArgsType(clientType, 'newRoute');
        const query = args.getProperty('query');
        if (!query) throw new Error('query missing');
        const queryType = checker.getTypeOfSymbol(query);
        expect(hasDeprecated(propertyTags(queryType, 'page'))).toBe(true);
    });
});
