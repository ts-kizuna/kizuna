/**
 * The specification says a name should be at most 128 characters, but that is
 * the wrong budget to write against. Cursor rejects anything over 60, and a
 * client that aggregates several servers prefixes every name with the server's,
 * so the name a model sees is longer than the one published.
 *
 * 56 leaves room for that prefix. This is the same reasoning that rewrites the
 * dot: publishing a name a client truncates means the tool is called something
 * kizuna never chose.
 */
const MAX_TOOL_NAME_LENGTH = 56;

/**
 * The specification allows a dot too, and kizuna's own route and tool keys are
 * dotted. Claude and GitHub Copilot validate against this narrower set and
 * reject the whole tool list over one name outside it, so the dot does not
 * survive here.
 */
const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

const toSnakeCase = (segment: string): string =>
    segment
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
        .toLowerCase();

/**
 * `users.listUsers` becomes `users_list_users`, the shape MCP servers publish
 * and models are trained on.
 */
export const toToolName = (key: string): string => key.split('.').map(toSnakeCase).join('_');

/**
 * What a tool name was derived from. Routes and declared tools share one
 * namespace, so a collision between the two names both sides.
 */
export type ToolOrigin = 'route' | 'tool';

/**
 * One candidate for a tool name: the dotted key, and what declared it.
 */
export interface ToolNameEntry {
    key: string;
    origin: ToolOrigin;
}

const sentenceLabel = (origin: ToolOrigin): string => (origin === 'route' ? 'Route' : 'Tool');

/**
 * Every key mapped to its published tool name, throwing on a name MCP clients
 * reject and on two keys that converge on one name.
 */
export const deriveToolNames = (entries: ToolNameEntry[]): Map<string, string> => {
    const names = new Map<string, string>();
    const claimedBy = new Map<string, ToolNameEntry>();

    for (const entry of entries) {
        const { key, origin } = entry;
        const name = toToolName(key);

        if (!TOOL_NAME_PATTERN.test(name)) {
            throw new Error(
                `${sentenceLabel(origin)} "${key}" becomes the tool name "${name}", which contains characters ` +
                    `outside the letters, digits, underscore, and dash that MCP clients accept. ` +
                    `Rename the ${origin}.`
            );
        }

        if (name.length > MAX_TOOL_NAME_LENGTH) {
            throw new Error(
                `${sentenceLabel(origin)} "${key}" becomes the tool name "${name}", which is ${name.length} characters, ` +
                    `over the ${MAX_TOOL_NAME_LENGTH} kizuna publishes within. ` +
                    `The specification allows 128, but Cursor rejects anything over 60 and clients that aggregate servers ` +
                    `prefix every name, so a longer one reaches the model truncated. Use a shorter key.`
            );
        }

        const claimant = claimedBy.get(name);
        if (claimant !== undefined) {
            throw new Error(
                `${sentenceLabel(claimant.origin)} "${claimant.key}" and ${origin} "${key}" both become the tool name "${name}". ` +
                    `Rename one of them.`
            );
        }

        claimedBy.set(name, entry);
        names.set(key, name);
    }

    return names;
};
