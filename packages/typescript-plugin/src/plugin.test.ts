import { describe, expect, test } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';

// tsserver plugins are CommonJS, so load the built dist as tsserver does. Run
// `pnpm build` in this package after changing index.cts.
const requireFromHere = createRequire(import.meta.url);
const init = requireFromHere('../dist/index.cjs') as typeof import('./index.cts');

const fixtureDir = path.dirname(url.fileURLToPath(import.meta.url));
const fixturePath = path.resolve(fixtureDir, 'deprecation.fixture.ts');
const fixtureText = fs.readFileSync(fixturePath, 'utf8');

const compilationSettings: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    esModuleInterop: true,
    noEmit: true,
};

const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [fixturePath],
    getScriptVersion: () => '1',
    getScriptSnapshot: (fileName) => {
        if (!fs.existsSync(fileName)) return undefined;
        return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, 'utf8'));
    },
    getCurrentDirectory: () => fixtureDir,
    getCompilationSettings: () => compilationSettings,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
};

const baseService = ts.createLanguageService(host);
const plugin = init({ typescript: ts });
const service = plugin.create({
    languageService: baseService,
    languageServiceHost: host,
    config: {},
} as unknown as ts.server.PluginCreateInfo);

const positionOf = (snippet: string, property: string): number => {
    const snippetIndex = fixtureText.indexOf(snippet);
    if (snippetIndex === -1) throw new Error(`snippet not found: ${snippet}`);
    return snippetIndex + snippet.lastIndexOf(property);
};

const deprecationDiagnostics = service.getSuggestionDiagnostics(fixturePath).filter((diagnostic) => diagnostic.reportsDeprecated);

const diagnosticAt = (position: number): ts.DiagnosticWithLocation | undefined =>
    deprecationDiagnostics.find((diagnostic) => diagnostic.start === position);

describe('suggestion diagnostics', () => {
    test('route-level deprecated property flags the client method usage', () => {
        const diagnostic = diagnosticAt(positionOf('client.oldRoute()', 'oldRoute'));
        expect(diagnostic).toBeDefined();
        expect(diagnostic?.messageText).toContain('use newRoute instead');
    });

    test('a deprecated object with a message flags the client method usage', () => {
        const diagnostic = diagnosticAt(positionOf('client.detailedRoute()', 'detailedRoute'));
        expect(diagnostic).toBeDefined();
        expect(diagnostic?.messageText).toContain('use newRoute instead');
    });

    test('a deprecated object without a message still flags the client method usage', () => {
        expect(diagnosticAt(positionOf('client.datedRoute()', 'datedRoute'))).toBeDefined();
    });

    test('non-deprecated routes are not flagged', () => {
        expect(diagnosticAt(positionOf('client.newRoute()', 'newRoute'))).toBeUndefined();
    });

    test('meta-deprecated field flags the response body usage', () => {
        const diagnostic = diagnosticAt(positionOf('userResponse.body.email)', 'email'));
        expect(diagnostic).toBeDefined();
        expect(diagnostic?.messageText).toContain('use email_address instead');
    });

    test('non-deprecated fields are not flagged', () => {
        expect(diagnosticAt(positionOf('userResponse.body.email_address)', 'email_address'))).toBeUndefined();
    });

    test('meta-deprecated field is flagged through a generic wrapper schema', () => {
        expect(diagnosticAt(positionOf('pageResponse.body.items[0]?.email', 'email'))).toBeDefined();
    });
});

describe('native JSDoc deprecations pass through', () => {
    test('a JSDoc-deprecated property usage keeps its native diagnostic, exactly once', () => {
        const position = positionOf('legacy.oldField)', 'oldField');
        const matches = deprecationDiagnostics.filter((diagnostic) => diagnostic.start === position);
        expect(matches).toHaveLength(1);
    });

    test('a JSDoc-deprecated function usage keeps its native diagnostic', () => {
        expect(diagnosticAt(positionOf('oldHelper();', 'oldHelper'))).toBeDefined();
    });

    test('non-deprecated siblings of JSDoc-deprecated members are not flagged', () => {
        expect(diagnosticAt(positionOf('legacy.fresh)', 'fresh'))).toBeUndefined();
    });

    test('hover on a JSDoc-deprecated property carries exactly one deprecated tag', () => {
        const quickInfo = service.getQuickInfoAtPosition(fixturePath, positionOf('legacy.oldField)', 'oldField'));
        const tags = quickInfo?.tags?.filter((candidate) => candidate.name === 'deprecated') ?? [];
        expect(tags).toHaveLength(1);
    });
});

describe('quick info', () => {
    test('deprecated route hover carries a deprecated tag with the message', () => {
        const quickInfo = service.getQuickInfoAtPosition(fixturePath, positionOf('client.oldRoute()', 'oldRoute'));
        const tag = quickInfo?.tags?.find((candidate) => candidate.name === 'deprecated');
        expect(tag).toBeDefined();
        expect(tag?.text?.map((part) => part.text).join('')).toBe('use newRoute instead');
    });

    test('deprecated field hover carries a deprecated tag with the message', () => {
        const quickInfo = service.getQuickInfoAtPosition(fixturePath, positionOf('userResponse.body.email)', 'email'));
        const tag = quickInfo?.tags?.find((candidate) => candidate.name === 'deprecated');
        expect(tag).toBeDefined();
        expect(tag?.text?.map((part) => part.text).join('')).toBe('use email_address instead');
    });

    test('deprecated object hover carries a deprecated tag with its message', () => {
        const quickInfo = service.getQuickInfoAtPosition(fixturePath, positionOf('client.detailedRoute()', 'detailedRoute'));
        const tag = quickInfo?.tags?.find((candidate) => candidate.name === 'deprecated');
        expect(tag).toBeDefined();
        expect(tag?.text?.map((part) => part.text).join('')).toBe('use newRoute instead');
    });

    test('non-deprecated route hover has no deprecated tag', () => {
        const quickInfo = service.getQuickInfoAtPosition(fixturePath, positionOf('client.newRoute()', 'newRoute'));
        expect(quickInfo?.tags?.find((candidate) => candidate.name === 'deprecated')).toBeUndefined();
    });
});

describe('completions', () => {
    test('deprecated client method completes with a deprecated kind modifier', () => {
        const completions = service.getCompletionsAtPosition(fixturePath, positionOf('client.oldRoute()', 'oldRoute'), undefined);
        const oldRouteEntry = completions?.entries.find((entry) => entry.name === 'oldRoute');
        const newRouteEntry = completions?.entries.find((entry) => entry.name === 'newRoute');
        expect(oldRouteEntry?.kindModifiers).toContain('deprecated');
        expect(newRouteEntry?.kindModifiers ?? '').not.toContain('deprecated');
    });
});
