import type { Rule, SourceCode } from 'eslint';

type Comment = ReturnType<SourceCode['getAllComments']>[number];

/**
 * A JSDoc inline tag — `{@link …}`, `{@linkcode …}`, `{@tutorial …}`, any `{@tag}`.
 */
const JSDOC_INLINE_TAG = /\{@[a-zA-Z][\w-]*/;

const stripLinePrefix = (line: string): string => line.replace(/^\s*\*? ?/, '');

/**
 * Disallows JSDoc inline tags in `@deprecated` messages. kizuna serializes the
 * deprecation text verbatim to generated clients, and native/mobile clients can't
 * parse tags like `{@link}`.
 */
export const noJsdocTagsInDeprecations: Rule.RuleModule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Disallow JSDoc inline tags (e.g. {@link}) in @deprecated messages; kizuna surfaces the deprecation text verbatim to generated clients that cannot parse them.',
        },
        messages: {
            noTag: 'JSDoc inline tags like {@link} are not supported in a @deprecated message. kizuna surfaces this text verbatim to generated clients — including native and mobile clients that cannot parse it. Use plain text instead (backticks are fine).',
        },
        schema: [],
    },
    create(context) {
        const sourceCode = context.sourceCode;
        let usesKizuna = false;

        // A block tag's message runs until the next `@`-tag line, so scan only while
        // inside the `@deprecated` region.
        const deprecatedMessageHasInlineTag = (comment: Comment): boolean => {
            if (comment.type !== 'Block' || !comment.value.startsWith('*')) return false;

            let inDeprecated = false;
            for (const line of comment.value.split('\n')) {
                const content = stripLinePrefix(line);
                const blockTag = /^@(\w+)/.exec(content);
                if (blockTag) inDeprecated = blockTag[1] === 'deprecated';
                if (inDeprecated && JSDOC_INLINE_TAG.test(content)) return true;
            }
            return false;
        };

        return {
            ImportDeclaration(node) {
                if (typeof node.source.value === 'string' && node.source.value.startsWith('@ts-kizuna/')) {
                    usesKizuna = true;
                }
            },
            'Program:exit'() {
                if (!usesKizuna) return;
                for (const comment of sourceCode.getAllComments()) {
                    if (!deprecatedMessageHasInlineTag(comment)) continue;
                    // Report on the documented declaration, not the comment.
                    const target = sourceCode.getTokenAfter(comment) ?? comment;
                    context.report({
                        loc: target.loc!,
                        messageId: 'noTag',
                    });
                }
            },
        };
    },
};
