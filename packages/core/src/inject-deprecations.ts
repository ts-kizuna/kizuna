import ts from 'typescript';
import type { DeprecationMap } from './deprecation.js';

/**
 * Flatten a `DeprecationMap` to a `fieldName -> message` map.
 *
 * Field paths are dotted (e.g. `responses.200.email`); we key by the last
 * segment because the emitted `.d.ts` represents fields as zod-type wrappers
 * whose structure does not match the source-derived path dialect. Matching by
 * field name avoids reconciling the two. When a name appears with both an empty
 * and a non-empty message, the non-empty message wins.
 */
export const collectDeprecatedFieldNames = (map: DeprecationMap): Map<string, string> => {
    const names = new Map<string, string>();
    const add = (fieldPath: string, message: string): void => {
        const fieldName = fieldPath.split('.').pop();
        if (fieldName === undefined || fieldName === '') return;
        const existing = names.get(fieldName);
        if (existing === undefined || (existing === '' && message !== '')) {
            names.set(fieldName, message);
        }
    };
    for (const fields of map.fields.values()) {
        for (const [fieldPath, message] of fields) add(fieldPath, message);
    }
    if (map.schemas) {
        for (const fields of map.schemas.values()) {
            for (const [fieldPath, message] of fields) add(fieldPath, message);
        }
    }
    return names;
};

const propertyNameText = (name: ts.PropertyName): string | undefined => {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
    return undefined;
};

const entityNameText = (name: ts.EntityName): string =>
    ts.isIdentifier(name) ? name.text : `${entityNameText(name.left)}.${name.right.text}`;

/**
 * True when the property is a member of a `z.ZodObject<{…}>` type literal — i.e.
 * its parent is the first type argument of a `ZodObject` type reference. Wrapper
 * types (`ZodOptional`, `ZodArray`, …) don't matter: we only check the immediate
 * `ZodObject` that owns the member, so wrapped objects are still matched.
 */
const isZodObjectMember = (property: ts.PropertySignature): boolean => {
    const typeLiteral = property.parent;
    if (!ts.isTypeLiteralNode(typeLiteral)) return false;
    const reference = typeLiteral.parent;
    if (!ts.isTypeReferenceNode(reference)) return false;
    if (reference.typeArguments?.[0] !== typeLiteral) return false;
    const referenceName = entityNameText(reference.typeName);
    return referenceName === 'ZodObject' || referenceName.endsWith('.ZodObject');
};

const hasDeprecatedTag = (node: ts.Node): boolean =>
    ts.getJSDocTags(node).some((tag) => tag.tagName.text === 'deprecated');

/**
 * Inject `@deprecated` JSDoc into a single `.d.ts` source string.
 *
 * Pure: takes the declaration text plus a `fieldName -> message` map and returns
 * the rewritten text. Any property signature whose name is in the map gets a
 * multi-line `@deprecated` JSDoc inserted above it.
 */
export const injectDeprecatedTags = (declarationSource: string, deprecatedFields: Map<string, string>): string => {
    if (deprecatedFields.size === 0) return declarationSource;

    const sourceFile = ts.createSourceFile('module.d.ts', declarationSource, ts.ScriptTarget.Latest, true);
    const insertions: { position: number; text: string }[] = [];

    const visit = (node: ts.Node): void => {
        if (ts.isPropertySignature(node)) {
            const fieldName = propertyNameText(node.name);
            if (
                fieldName !== undefined &&
                deprecatedFields.has(fieldName) &&
                isZodObjectMember(node) &&
                !hasDeprecatedTag(node)
            ) {
                const start = node.getStart(sourceFile);
                const lineStart = declarationSource.lastIndexOf('\n', start - 1) + 1;
                const indent = declarationSource.slice(lineStart, start);
                const message = deprecatedFields.get(fieldName)!;
                const tagLine = message === '' ? `${indent} * @deprecated\n` : `${indent} * @deprecated ${message}\n`;
                insertions.push({
                    position: lineStart,
                    text: `${indent}/**\n${tagLine}${indent} */\n`,
                });
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    if (insertions.length === 0) return declarationSource;
    insertions.sort((first, second) => second.position - first.position);
    let result = declarationSource;
    for (const insertion of insertions) {
        result = result.slice(0, insertion.position) + insertion.text + result.slice(insertion.position);
    }
    return result;
};
