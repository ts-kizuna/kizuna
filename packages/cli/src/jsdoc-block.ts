import ts from 'typescript';
import type { JsDocTag } from '@ts-kizuna/core/authoring-names';
import type { JsDocEntry } from '@ts-kizuna/core/generator';

/**
 * Returns the verbatim leading JSDoc block (`/** … *\/`) on a node, or undefined
 * when it has none.
 */
export const readJsDocBlock = (node: ts.Node): string | undefined => {
    const sourceFile = node.getSourceFile();
    const ranges = ts.getLeadingCommentRanges(sourceFile.text, node.getFullStart()) ?? [];
    const jsDoc = ranges.filter((range) => sourceFile.text.slice(range.pos, range.pos + 3) === '/**').at(-1);
    return jsDoc ? sourceFile.text.slice(jsDoc.pos, jsDoc.end) : undefined;
};

/**
 * Strips the block delimiters and the leading `*` gutter, leaving the comment's
 * own text with its relative indentation intact.
 */
const stripDelimiters = (block: string): string =>
    block
        .replace(/^\/\*\*/, '')
        .replace(/\*\/\s*$/, '')
        .split('\n')
        .map((line) => line.replace(/^[ \t]*\*[ \t]?/, ''))
        .join('\n');

interface Tag {
    name: string;
    body: string;
}

const TAG_LINE = /^@(\w+)[ \t]*(.*)$/;

const splitTags = (text: string): Tag[] => {
    const tags: Tag[] = [];
    let current: { name: string; lines: string[] } | undefined;

    const flush = (): void => {
        if (!current) return;
        tags.push({
            name: current.name,
            body: current.lines.join('\n').trim(),
        });
        current = undefined;
    };

    for (const line of text.split('\n')) {
        const match = TAG_LINE.exec(line.trim());
        if (match) {
            flush();
            current = {
                name: match[1]!,
                lines: [match[2]!],
            };
            continue;
        }
        if (current) current.lines.push(line);
    }
    flush();

    return tags;
};

const literalValue = (node: ts.Expression): { value: unknown } | undefined => {
    if (ts.isStringLiteralLike(node)) return { value: node.text };
    if (ts.isNumericLiteral(node)) return { value: Number(node.text) };
    if (node.kind === ts.SyntaxKind.TrueKeyword) return { value: true };
    if (node.kind === ts.SyntaxKind.FalseKeyword) return { value: false };
    if (node.kind === ts.SyntaxKind.NullKeyword) return { value: null };
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
        const operand = literalValue(node.operand);
        return operand && typeof operand.value === 'number' ? { value: -operand.value } : undefined;
    }
    if (ts.isArrayLiteralExpression(node)) {
        const values: unknown[] = [];
        for (const element of node.elements) {
            const parsed = literalValue(element);
            if (!parsed) return undefined;
            values.push(parsed.value);
        }
        return { value: values };
    }
    if (ts.isObjectLiteralExpression(node)) {
        const value: Record<string, unknown> = {};
        for (const property of node.properties) {
            if (!ts.isPropertyAssignment(property)) return undefined;
            const key = ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) ? property.name.text : undefined;
            if (key === undefined) return undefined;
            const parsed = literalValue(property.initializer);
            if (!parsed) return undefined;
            value[key] = parsed.value;
        }
        return { value };
    }
    return undefined;
};

const FENCE = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/;

/**
 * The value an `@example` tag documents. A JSON or JavaScript literal becomes the
 * value itself, so it can be emitted into an OpenAPI `examples` array; anything
 * else (prose, a curl line, a code snippet) stays the raw text. A fenced code
 * block is unwrapped first, since that is how JSDoc examples usually read best on
 * hover.
 */
export const parseExampleValue = (body: string): unknown => {
    const fenced = FENCE.exec(body.trim());
    const text = (fenced ? fenced[1]! : body).trim();
    if (text === '') return text;
    const sourceFile = ts.createSourceFile('example.ts', `(${text})`, ts.ScriptTarget.Latest, true);
    const statement = sourceFile.statements[0];
    if (
        sourceFile.statements.length === 1 &&
        statement &&
        ts.isExpressionStatement(statement) &&
        ts.isParenthesizedExpression(statement.expression)
    ) {
        const parsed = literalValue(statement.expression.expression);
        if (parsed) return parsed.value;
    }
    return text;
};

/**
 * Parses a JSDoc block into a {@link JsDocEntry}, reading only the tags kizuna
 * defines. Untagged prose is ignored. Returns undefined for a block with none
 * of those tags.
 */
export const parseJsDoc = (block: string): JsDocEntry | undefined => {
    const tags = splitTags(stripDelimiters(block));

    // Typed against the shared tag list, so a tag read here but not declared there
    // fails to compile.
    const bodyOf = (name: JsDocTag): string | undefined => tags.find((tag) => tag.name === name)?.body;

    const summary = bodyOf('summary');
    const description = bodyOf('description');
    const deprecated = bodyOf('deprecated');
    const examples = tags.filter((tag) => tag.name === ('example' satisfies JsDocTag)).map((tag) => parseExampleValue(tag.body));

    const entry: JsDocEntry = {};
    if (summary) entry.summary = summary;
    if (description) entry.description = description;
    if (examples.length > 0) entry.examples = examples;
    if (deprecated !== undefined) entry.deprecated = deprecated;

    return Object.keys(entry).length > 0 ? entry : undefined;
};

/**
 * Parses the JSDoc block leading `node`, if any.
 */
export const readJsDocEntry = (node: ts.Node): JsDocEntry | undefined => {
    const block = readJsDocBlock(node);
    return block === undefined ? undefined : parseJsDoc(block);
};
