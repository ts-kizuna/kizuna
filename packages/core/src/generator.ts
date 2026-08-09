import {
    contractFingerprint,
    serializeJsDocMap,
    deserializeJsDocMap,
    jsDocText,
    type JsDocEntry,
    type JsDocMap,
    type SerializedJsDocMap,
} from './jsdoc.js';
import { loadJsDoc } from './load-jsdoc.js';
import { flattenRoutes } from './handler-pipeline.js';
import { parsePath } from './path-params.js';
import type { Routes, RouteDefinition } from './types.js';
import type { Contract } from './contract.js';

export {
    loadJsDoc,
    contractFingerprint,
    serializeJsDocMap,
    deserializeJsDocMap,
    jsDocText,
    type JsDocEntry,
    type JsDocMap,
    type SerializedJsDocMap,
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
     * The JSDoc written above this route in the routes source: summary,
     * description, examples, and `@deprecated`. `undefined` when the route has no
     * doc comment.
     */
    jsDoc: JsDocEntry | undefined;
    /**
     * Whether this route is marked `@deprecated` in the routes source.
     */
    deprecated: boolean;
    /**
     * The text after `@deprecated`, or `undefined` for a bare tag or non-deprecated route.
     */
    deprecationMessage: string | undefined;
    /**
     * Field-path → JSDoc for pathParams/body/query/headers/responses fields on
     * this route. `undefined` when no field on the route is documented.
     */
    fieldJsDoc: Map<string, JsDocEntry> | undefined;
}

/**
 * Factory for building type-safe routes generators.
 *
 * Centralises routes walking and JSDoc resolution so generator authors only need
 * to implement `processRoute` and `finalize`.
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
        const jsDocMap = loadJsDoc(contractFingerprint(contract));
        for (const { routeKey, route, routeTags } of flattenRoutes(contract.routes)) {
            const jsDoc = jsDocMap?.routes.get(routeKey);
            processRoute({
                routeKey,
                route,
                routeTags,
                jsDoc,
                deprecated: jsDoc?.deprecated !== undefined,
                deprecationMessage: jsDoc?.deprecated || undefined,
                fieldJsDoc: jsDocMap?.fields.get(routeKey),
            });
        }
        return finalize();
    };
