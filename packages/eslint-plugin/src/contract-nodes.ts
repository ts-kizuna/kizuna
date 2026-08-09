import { type TSESTree } from '@typescript-eslint/utils';
import { AUTHORING_NAMES } from '@ts-kizuna/core/authoring-names';

const SCHEMA_KEYS: ReadonlySet<string> = new Set(['body', 'query', 'pathParams', 'headers']);

const calleeName = (call: TSESTree.CallExpression): string | undefined => {
    const callee = call.callee;
    if (callee.type === 'Identifier') return callee.name;
    if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') return callee.property.name;
    return undefined;
};

const visitEvery = (node: TSESTree.Node, visit: (node: TSESTree.Node) => void): void => {
    visit(node);
    for (const [key, child] of Object.entries(node)) {
        if (key === 'parent') continue;
        if (Array.isArray(child)) child.forEach((item) => item?.type && visitEvery(item, visit));
        else if (child?.type) visitEvery(child, visit);
    }
};

/**
 * The schema expressions a `k.routes` / `k.contract` / `Kizuna.model` call carries:
 * each route's `body`/`query`/`pathParams`/`headers` and each status response.
 */
export const schemaNodesOf = (call: TSESTree.CallExpression): TSESTree.Node[] => {
    const name = calleeName(call);
    if (name === AUTHORING_NAMES.model) {
        const config = call.arguments[0];
        if (config?.type !== 'ObjectExpression') return [];
        const schema = config.properties.find(
            (property): property is TSESTree.Property =>
                property.type === 'Property' && property.key.type === 'Identifier' && property.key.name === 'schema'
        );
        return schema ? [schema.value] : [];
    }

    if (name !== AUTHORING_NAMES.routes && name !== AUTHORING_NAMES.contract) return [];

    const nodes: TSESTree.Node[] = [];
    for (const argument of call.arguments) {
        visitEvery(argument, (node) => {
            if (node.type !== 'Property') return;
            const isSchemaField = node.key.type === 'Identifier' && SCHEMA_KEYS.has(node.key.name);
            const isStatusResponse = node.key.type === 'Literal' && typeof node.key.value === 'number';
            if (isSchemaField || isStatusResponse) nodes.push(node.value);
        });
    }
    return nodes;
};

/**
 * Every property inside a `k.routes` / `k.contract` / `Kizuna.model` call, for
 * checks that care about the JSDoc on a member rather than the schema under it.
 * Routes, groups, response status keys, and plain option properties all come
 * back; a doc comment is legal on any of them.
 */
export const contractPropertiesOf = (call: TSESTree.CallExpression): TSESTree.Property[] => {
    const name = calleeName(call);
    if (name !== AUTHORING_NAMES.model && name !== AUTHORING_NAMES.routes && name !== AUTHORING_NAMES.contract) return [];

    const properties: TSESTree.Property[] = [];
    for (const argument of call.arguments) {
        visitEvery(argument, (node) => {
            if (node.type === 'Property') properties.push(node);
        });
    }
    return properties;
};
