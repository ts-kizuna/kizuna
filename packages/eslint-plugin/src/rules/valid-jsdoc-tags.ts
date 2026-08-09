import { ESLintUtils } from '@typescript-eslint/utils';
import { contractPropertiesOf } from '../contract-nodes.js';
import { collectTagViolations, type TagIssue } from '../jsdoc-tags.js';

const DEFAULT_MAX_SUMMARY_LENGTH = 120;

const MESSAGE_IDS = {
    'unknown-tag': 'unknownTag',
    'duplicate-tag': 'duplicateTag',
    'empty-tag': 'emptyTag',
    'long-summary': 'longSummary',
} as const satisfies Record<TagIssue, string>;

export interface ValidJsDocTagsOptions {
    maxSummaryLength?: number;
}

export const validJsDocTags = ESLintUtils.RuleCreator.withoutDocs<[ValidJsDocTagsOptions], keyof typeof MESSAGE_IDS | string>({
    meta: {
        type: 'problem',
        fixable: 'code',
        docs: {
            description:
                'Check the JSDoc tags ts-kizuna reads off contract routes and schema fields: catch misspelled tags, empty tags, and overlong summaries.',
        },
        messages: {
            unknownTag:
                '`@{{tag}}` is not read by ts-kizuna. Contract JSDoc carries only @description, @summary, @example, and @deprecated.',
            duplicateTag: 'A second `@{{tag}}`. ts-kizuna keeps the first and drops this one.',
            emptyTag: '`@{{tag}}` has no text after it.',
            longSummary:
                '`@summary` is {{length}} characters. OpenAPI list views truncate past ~{{max}}, so move the detail to `@description`.',
        },
        schema: [
            {
                type: 'object',
                properties: {
                    maxSummaryLength: {
                        type: 'number',
                        minimum: 1,
                    },
                },
                additionalProperties: false,
            },
        ],
    },
    defaultOptions: [{}],
    create(context, [options]) {
        const services = ESLintUtils.getParserServices(context, true);
        const sourceCode = context.sourceCode;
        const maxSummaryLength = options?.maxSummaryLength ?? DEFAULT_MAX_SUMMARY_LENGTH;
        const reported = new Set<number>();

        return {
            CallExpression(call) {
                for (const property of contractPropertiesOf(call)) {
                    const tsNode = services.esTreeNodeToTSNodeMap.get(property);
                    if (!tsNode) continue;
                    for (const violation of collectTagViolations(tsNode, { maxSummaryLength })) {
                        if (reported.has(violation.start)) continue;
                        reported.add(violation.start);
                        const loc = {
                            start: sourceCode.getLocFromIndex(violation.start),
                            end: sourceCode.getLocFromIndex(violation.end),
                        };
                        context.report({
                            loc,
                            messageId: MESSAGE_IDS[violation.issue],
                            data: {
                                tag: violation.tag,
                                length: String(violation.length ?? 0),
                                max: String(maxSummaryLength),
                            },
                            fix:
                                violation.suggestion === undefined
                                    ? undefined
                                    : (fixer) => fixer.replaceTextRange([violation.start, violation.end], violation.suggestion!),
                        });
                    }
                }
            },
        };
    },
});
