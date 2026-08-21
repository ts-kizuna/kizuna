import ts from 'typescript';

/**
 * Resolves an identifier appearing inside a schema to the expression it was defined as
 * (a `const`'s initializer), following it across files. Backed by the TS type checker.
 */
export type SchemaResolver = (identifier: ts.Identifier) => ts.Expression | undefined;

/**
 * The ways a kizuna schema can be illegal: `coerce` (uses `z.coerce`).
 */
export type SchemaIssue = 'coerce';

/**
 * An issue and the exact node that carries it, the `z.coerce` access or the offending
 * field. `viaReference` is true when it was reached by following an identifier to a named
 * schema, so the caller reports it on the reference rather than the (possibly remote) node.
 */
export interface SchemaViolation {
    issue: SchemaIssue;
    node: ts.Node;
    viaReference: boolean;
}

/**
 * Walks a schema expression, following `z.object` shapes, nested objects, and identifier
 * references to other schemas (across files), and returns every issue it carries, each
 * paired with the node it sits on. The walk is bounded by a visited set so cycles end.
 */
export const collectSchemaIssues = (root: ts.Node, resolve: SchemaResolver): SchemaViolation[] => {
    const violations: SchemaViolation[] = [];
    const reported = new Set<string>();
    const visited = new Set<ts.Node>();

    const add = (issue: SchemaIssue, node: ts.Node, viaReference: boolean): void => {
        const key = `${issue}@${node.getSourceFile().fileName}:${node.pos}`;
        if (reported.has(key)) return;
        reported.add(key);
        violations.push({ issue, node, viaReference });
    };

    const walk = (node: ts.Node, viaReference: boolean): void => {
        if (
            ts.isPropertyAccessExpression(node) &&
            node.name.text === 'coerce' &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === 'z'
        ) {
            add('coerce', node, viaReference);
        }

        if (ts.isIdentifier(node)) {
            const target = resolve(node);
            if (target && !visited.has(target)) {
                visited.add(target);
                walk(target, true);
            }
        }

        ts.forEachChild(node, (child) => walk(child, viaReference));
    };

    visited.add(root);
    walk(root, false);
    return violations;
};
