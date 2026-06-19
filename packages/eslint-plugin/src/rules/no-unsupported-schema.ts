import { ESLintUtils, type TSESTree } from '@typescript-eslint/utils';
import ts from 'typescript';
import { collectSchemaIssues, type SchemaIssue, type SchemaResolver } from '../schema-violations.js';

const SCHEMA_KEYS: ReadonlySet<string> = new Set(['body', 'query', 'pathParams', 'headers']);

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
    if (name === 'createModel') {
        const config = call.arguments[0];
        if (config?.type !== 'ObjectExpression') return [];
        const schema = config.properties.find(
            (property): property is TSESTree.Property =>
                property.type === 'Property' && property.key.type === 'Identifier' && property.key.name === 'schema'
        );
        return schema ? [schema.value] : [];
    }

    if (name !== 'createContract' && name !== 'createApi' && name !== 'routes') return [];

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
            coerce: 'z.coerce is not supported in a ts-kizuna schema. kizuna coerces query, path, and header params automatically — use z.number(), z.date(), or z.bigint() instead.',
            jsdocTag:
                'This @deprecated message uses JSDoc inline tags like {@link}. kizuna surfaces deprecation text verbatim to generated clients that cannot parse it — use plain text instead (backticks are fine).',
            duplicateDeprecated:
                'This field has more than one @deprecated tag. kizuna serializes only the first and silently drops the rest — collapse them into a single message.',
            coerceReference:
                'This schema uses z.coerce, which ts-kizuna does not support. kizuna coerces query, path, and header params automatically — use z.number(), z.date(), or z.bigint() instead.',
            jsdocTagReference:
                'This schema has a @deprecated message with JSDoc inline tags like {@link}. kizuna surfaces deprecation text verbatim to generated clients that cannot parse it — use plain text instead (backticks are fine).',
            duplicateDeprecatedReference:
                'This schema has a field with more than one @deprecated tag. kizuna serializes only the first and silently drops the rest — collapse them into a single message.',
        },
        schema: [],
    },
    defaultOptions: [],
    create(context) {
        const services = ESLintUtils.getParserServices(context, true);
        if (!services.program) return {};

        const checker = services.program.getTypeChecker();
        const resolve: SchemaResolver = (identifier) => {
            const symbol = checker.getSymbolAtLocation(identifier);
            if (!symbol) return undefined;
            const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
            return resolved.declarations?.find(ts.isVariableDeclaration)?.initializer;
        };

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
