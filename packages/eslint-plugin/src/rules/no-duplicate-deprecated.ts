import type { Rule, SourceCode } from 'eslint';

type Comment = ReturnType<SourceCode['getAllComments']>[number];

const stripLinePrefix = (line: string): string => line.replace(/^\s*\*? ?/, '');

// A `@deprecated` block tag starts a line (after the `*` prefix), so each such line is one tag.
const countDeprecatedTags = (comment: Comment): number => {
    if (comment.type !== 'Block' || !comment.value.startsWith('*')) return 0;
    let count = 0;
    for (const line of comment.value.split('\n')) {
        if (/^@deprecated\b/.test(stripLinePrefix(line))) count += 1;
    }
    return count;
};

/**
 * Disallows more than one `@deprecated` tag in a JSDoc block. kizuna serializes only
 * the first message; any later one is silently dropped and never reaches a client.
 */
export const noDuplicateDeprecated: Rule.RuleModule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Disallow more than one @deprecated tag in a single JSDoc block; kizuna serializes only the first and silently drops the rest.',
        },
        messages: {
            duplicate:
                'Multiple @deprecated tags in one JSDoc block. kizuna serializes only the first message and silently drops the rest. Collapse them into a single @deprecated message.',
        },
        schema: [],
    },
    create(context) {
        const sourceCode = context.sourceCode;
        let usesKizuna = false;

        return {
            ImportDeclaration(node) {
                if (typeof node.source.value === 'string' && node.source.value.startsWith('@ts-kizuna/')) {
                    usesKizuna = true;
                }
            },
            'Program:exit'() {
                if (!usesKizuna) return;
                for (const comment of sourceCode.getAllComments()) {
                    if (countDeprecatedTags(comment) < 2) continue;
                    // Report on the documented declaration, not the comment.
                    const target = sourceCode.getTokenAfter(comment) ?? comment;
                    context.report({
                        loc: target.loc!,
                        messageId: 'duplicate',
                    });
                }
            },
        };
    },
};
