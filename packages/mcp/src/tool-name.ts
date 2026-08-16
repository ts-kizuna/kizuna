import type { FlattenedRoute } from '@ts-kizuna/shared/adapter';

const MAX_TOOL_NAME_LENGTH = 128;

export const deriveToolNames = (routes: FlattenedRoute[]): Map<string, string> => {
    const names = new Map<string, string>();
    for (const { routeKey } of routes) {
        if (routeKey.length > MAX_TOOL_NAME_LENGTH) {
            throw new Error(
                `Tool name "${routeKey}" is ${routeKey.length} characters, ` +
                    `exceeding the MCP recommended maximum of ${MAX_TOOL_NAME_LENGTH}. ` +
                    `Restructure your routes to use shorter keys.`
            );
        }
        names.set(routeKey, routeKey);
    }
    return names;
};
