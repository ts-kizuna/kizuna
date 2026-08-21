import type { FlattenedRoute } from '@ts-kizuna/core/adapter';

/**
 * Set by the MCP specification.
 *
 * @see https://modelcontextprotocol.io/specification/latest/server/tools
 */
const MAX_TOOL_NAME_LENGTH = 128;

/**
 * The specification allows a dot too, and kizuna's own route keys are dotted.
 * Claude and GitHub Copilot validate against this narrower set and reject the
 * whole tool list over one name outside it, so the dot does not survive here.
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
export const toToolName = (routeKey: string): string => routeKey.split('.').map(toSnakeCase).join('_');

export const deriveToolNames = (routes: FlattenedRoute[]): Map<string, string> => {
    const names = new Map<string, string>();
    const claimedBy = new Map<string, string>();

    for (const { routeKey } of routes) {
        const name = toToolName(routeKey);

        if (!TOOL_NAME_PATTERN.test(name)) {
            throw new Error(
                `Route "${routeKey}" becomes the tool name "${name}", which contains characters ` +
                    `outside the letters, digits, underscore, and dash that MCP clients accept. ` +
                    `Rename the route.`
            );
        }

        if (name.length > MAX_TOOL_NAME_LENGTH) {
            throw new Error(
                `Route "${routeKey}" becomes the tool name "${name}", which is ${name.length} characters, ` +
                    `exceeding the MCP maximum of ${MAX_TOOL_NAME_LENGTH}. ` +
                    `Restructure your routes to use shorter keys.`
            );
        }

        const claimant = claimedBy.get(name);
        if (claimant !== undefined) {
            throw new Error(`Routes "${claimant}" and "${routeKey}" both become the tool name "${name}". Rename one of them.`);
        }

        claimedBy.set(name, routeKey);
        names.set(routeKey, name);
    }

    return names;
};
