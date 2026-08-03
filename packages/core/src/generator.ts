import {
    contractFingerprint,
    serializeDeprecationMap,
    deserializeDeprecationMap,
    type DeprecationMap,
    type SerializedDeprecationMap,
} from './deprecation.js';
import { loadDeprecations } from './load-deprecations.js';
import { flattenRoutes } from './handler-pipeline.js';
import { parsePath } from './path-params.js';
import type { Routes, RouteDefinition } from './types.js';
import type { Contract } from './contract.js';

export {
    loadDeprecations,
    contractFingerprint,
    serializeDeprecationMap,
    deserializeDeprecationMap,
    type DeprecationMap,
    type SerializedDeprecationMap,
};
export type { Routes, RouteDefinition };
export { parsePath };

export {
    FILE_PROBE,
    isFileSchema,
    isBinarySchema,
    isVoidSchema,
    isObjectSchema,
    isIntegerSchema,
    isDiscriminatedUnionSchema,
    readDef,
    readDefType,
    readObjectShape,
    readDiscriminatedUnion,
    readMeta,
    readMetaId,
    readMetaDescription,
    readDiscriminatorLiteral,
    readDiscriminatorStringLiteral,
    globalRegistrySchemas,
    unwrapOptionalWrappers,
    type ZodDef,
    type DiscriminatedUnion,
} from './zod-internals.js';

export {
    resolveResponseBody,
    resolveResponseHeaders,
    resolveResponseContentType,
    resolveResponseEvent,
    isStreamResponse,
    streamContentType,
    isJsonMediaType,
    toPascalCase,
    toCamelCase,
    shortTypeName,
    isHintPrefix,
    localTypeName,
    sanitizeFieldName,
    sanitizeIdentifier,
    statusToCamelCase,
    isSuccessStatus,
    mergeHeaderFields,
} from './generator-utils.js';

export interface GeneratorRouteContext {
    routeKey: string;
    route: RouteDefinition;
    routeTags: string[];
    /**
     * Whether this route is marked `@deprecated` in the routes source.
     */
    deprecated: boolean;
    /**
     * The text after `@deprecated`, or `undefined` for a bare tag or non-deprecated route.
     */
    deprecationMessage: string | undefined;
    /**
     * Field-path → deprecation message for body/query/headers/responses fields
     * on this route. `undefined` when the route has no deprecated fields.
     */
    fieldDeprecations: Map<string, string> | undefined;
}

/**
 * Factory for building type-safe routes generators.
 *
 * Centralises routes walking and deprecation resolution so generator authors
 * only need to implement `processRoute` and `finalize`.
 *
 * ```ts
 * const generateRouteList = createGenerator(() => {
 *     const routeList: string[] = [];
 *     return {
 *         processRoute({ route, deprecated }) {
 *             routeList.push(`${route.method} ${route.path}${deprecated ? ' (deprecated)' : ''}`);
 *         },
 *         finalize() {
 *             return routeList;
 *         },
 *     };
 * });
 *
 * const list = generateRouteList(contract, {});
 * ```
 */
export const createGenerator =
    <Options, Output>(
        factory: (
            options: Options,
            contract: Contract
        ) => {
            processRoute: (context: GeneratorRouteContext) => void;
            finalize: () => Output;
        }
    ): ((contract: Contract, options: Options) => Output) =>
    (contract, options) => {
        const { processRoute, finalize } = factory(options, contract);
        const deprecation = loadDeprecations(contractFingerprint(contract));
        for (const { routeKey, route, routeTags } of flattenRoutes(contract.routes)) {
            const rawMessage = deprecation?.routes.get(routeKey);
            processRoute({
                routeKey,
                route,
                routeTags,
                deprecated: rawMessage !== undefined,
                deprecationMessage: rawMessage || undefined,
                fieldDeprecations: deprecation?.fields.get(routeKey),
            });
        }
        return finalize();
    };
