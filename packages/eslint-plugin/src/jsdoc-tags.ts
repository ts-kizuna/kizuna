import ts from 'typescript';
import { JSDOC_TAGS, KNOWN_FOREIGN_JSDOC_TAGS } from '@ts-kizuna/core/authoring-names';

/**
 * How a JSDoc tag on a contract member can be wrong: `unknown-tag` (not one of
 * the tags kizuna reads, so it is silently ignored), `duplicate-tag` (a second
 * `@description`, `@summary`, or `@deprecated`, of which the parser keeps only
 * the first), `empty-tag` (a tag with no text after it), `long-summary` (a
 * `@summary` past the configured length).
 */
export type TagIssue = 'unknown-tag' | 'duplicate-tag' | 'empty-tag' | 'long-summary';

export interface TagViolation {
    issue: TagIssue;
    /**
     * Source offsets of the tag name, without the `@`, for a precise report and
     * for the autofix to replace.
     */
    start: number;
    end: number;
    tag: string;
    /**
     * The tag the autofix renames this one to, when it is a near-miss spelling.
     */
    suggestion?: string;
    /**
     * The tag text's length. Only set for `long-summary`.
     */
    length?: number;
}

const KIZUNA_TAGS: readonly string[] = JSDOC_TAGS;
const FOREIGN: ReadonlySet<string> = new Set(KNOWN_FOREIGN_JSDOC_TAGS);

/**
 * The tags kizuna keeps only the first of. `@example` is absent because the
 * parser collects every one.
 */
const SINGLE_USE: ReadonlySet<string> = new Set(['description', 'summary', 'deprecated']);

/**
 * Levenshtein distance, bounded: it stops as soon as the answer must exceed
 * `limit`, so a long unrelated tag costs almost nothing to reject.
 */
const editDistance = (left: string, right: string, limit: number): number => {
    if (Math.abs(left.length - right.length) > limit) return limit + 1;
    let previous = Array.from({ length: right.length + 1 }, (_unused, index) => index);
    for (let row = 1; row <= left.length; row += 1) {
        const current = [row];
        let best = row;
        for (let column = 1; column <= right.length; column += 1) {
            const cost = left[row - 1] === right[column - 1] ? 0 : 1;
            const value = Math.min(current[column - 1]! + 1, previous[column]! + 1, previous[column - 1]! + cost);
            current.push(value);
            if (value < best) best = value;
        }
        if (best > limit) return limit + 1;
        previous = current;
    }
    return previous[right.length]!;
};

/**
 * The kizuna tag a misspelling is closest to, for the autofix. Tags of JSDoc's
 * own (`@param`, `@see`) get none: they are still errors, with nothing to
 * rename them to.
 */
export const nearestTag = (tag: string): string | undefined => {
    const candidate = tag.toLowerCase();
    if (KIZUNA_TAGS.includes(candidate) || FOREIGN.has(tag) || FOREIGN.has(candidate)) return undefined;
    // One edit for a short tag, two once there is enough of it to misspell twice.
    const limit = candidate.length > 6 ? 2 : 1;
    let best: { tag: string; distance: number } | undefined;
    for (const known of KIZUNA_TAGS) {
        const distance = editDistance(candidate, known, limit);
        if (distance <= limit && (!best || distance < best.distance)) best = { tag: known, distance };
    }
    return best?.tag;
};

export interface TagCheckOptions {
    maxSummaryLength: number;
}

/**
 * Checks the JSDoc tags written on `node` against the four kizuna reads. Reads
 * only this node's own comment, never a schema it references.
 */
export const collectTagViolations = (node: ts.Node, options: TagCheckOptions): TagViolation[] => {
    const violations: TagViolation[] = [];
    const seen = new Set<string>();

    for (const tag of ts.getJSDocTags(node)) {
        const name = tag.tagName.text;
        const body = ts.getTextOfJSDocComment(tag.comment) ?? '';
        const position = {
            start: tag.tagName.getStart(),
            end: tag.tagName.getEnd(),
            tag: name,
        };

        if (!KIZUNA_TAGS.includes(name)) {
            violations.push({
                issue: 'unknown-tag',
                ...position,
                suggestion: nearestTag(name),
            });
            continue;
        }

        if (SINGLE_USE.has(name) && seen.has(name)) {
            violations.push({
                issue: 'duplicate-tag',
                ...position,
            });
            continue;
        }
        seen.add(name);

        if (body.trim() === '' && name !== 'deprecated') {
            violations.push({
                issue: 'empty-tag',
                ...position,
            });
            continue;
        }

        if (name === 'summary' && body.trim().length > options.maxSummaryLength) {
            violations.push({
                issue: 'long-summary',
                ...position,
                length: body.trim().length,
            });
        }
    }
    return violations;
};
