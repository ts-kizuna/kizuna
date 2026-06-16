import type { Rule } from 'eslint';

/**
 * Flags `z.coerce` in files that import from `@ts-kizuna/*`. kizuna coerces query,
 * path, and header params to their declared types itself, so `z.coerce` is unsupported.
 */
export const noZCoerce: Rule.RuleModule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Disallow z.coerce in ts-kizuna contracts; kizuna coerces query, path, and header params to their declared types automatically.',
        },
        messages: {
            noCoerce:
                'z.coerce is not supported in a ts-kizuna contract. kizuna coerces query, path, and header params to their declared types automatically — use z.number(), z.date(), or z.bigint() instead.',
        },
        schema: [],
    },
    create(context) {
        let usesKizuna = false;
        return {
            ImportDeclaration(node) {
                if (typeof node.source.value === 'string' && node.source.value.startsWith('@ts-kizuna/')) {
                    usesKizuna = true;
                }
            },
            MemberExpression(node) {
                if (!usesKizuna) return;
                if (
                    node.property.type === 'Identifier' &&
                    node.property.name === 'coerce' &&
                    node.object.type === 'Identifier' &&
                    node.object.name === 'z'
                ) {
                    context.report({
                        node,
                        messageId: 'noCoerce',
                    });
                }
            },
        };
    },
};
