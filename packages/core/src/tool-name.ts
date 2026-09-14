/**
 * Set by the MCP specification, and matched by the Anthropic and OpenAI tool
 * APIs.
 *
 * @see https://modelcontextprotocol.io/specification/latest/server/tools
 */
const MAX_TOOL_NAME_LENGTH = 128;

/**
 * Narrower than the specification, which allows a dot. Anthropic's Messages
 * API, OpenAI's tool API and VS Code all reject one, so a dotted name is
 * unusable wherever it matters.
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
                    `over the MCP maximum of ${MAX_TOOL_NAME_LENGTH}. Use a shorter key.`
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
