import {
    contractFingerprint,
    serializeDeprecationMap,
    deserializeDeprecationMap,
    type DeprecationMap,
    type SerializedDeprecationMap,
} from '@ts-kizuna/contract';
import { flattenRoutes } from '@ts-kizuna/contract';
import { flattenJobs, isCompiledJob, jobAt, type CompiledJob, type FlattenedJob, type Jobs } from '@ts-kizuna/contract';
import { parsePath } from './path-params.js';
import type { Routes, RouteDefinition } from '@ts-kizuna/contract';
import type { Contract } from '@ts-kizuna/contract';

export { contractFingerprint, serializeDeprecationMap, deserializeDeprecationMap, type DeprecationMap, type SerializedDeprecationMap };
export type { Routes, RouteDefinition };
export { flattenJobs, isCompiledJob, jobAt };
export type { CompiledJob, FlattenedJob, Jobs };
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
 * Deprecations are passed in, not read here, so this module keeps out of
 * `node:fs`. Callers load them with `loadDeprecations`.
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
 * const list = generateRouteList(contract, {}, loadDeprecations(contractFingerprint(contract)));
 * ```
 */
export const createGenerator =
    <Options, Output>(
        factory: (
            options: Options,
            contract: Contract,
            deprecations: DeprecationMap | undefined
        ) => {
            processRoute: (context: GeneratorRouteContext) => void;
            finalize: () => Output;
        }
    ): ((contract: Contract, options: Options, deprecations?: DeprecationMap) => Output) =>
    (contract, options, deprecation) => {
        const { processRoute, finalize } = factory(options, contract, deprecation);
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
