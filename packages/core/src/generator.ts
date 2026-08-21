import { flattenRoutes } from './handler-pipeline.js';
import { flattenJobs, isCompiledJob, jobAt, type CompiledJob, type FlattenedJob, type Jobs } from './jobs.js';
import { parsePath } from './path-params.js';
import type { Routes, RouteDefinition } from './types.js';
import type { Contract } from './contract.js';

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
    readDeprecation,
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
     * Whether the route is deprecated.
     */
    deprecated: boolean;
    /**
     * The route's `deprecated` string, or `undefined` for `deprecated: true` or
     * a non-deprecated route.
     */
    deprecationMessage: string | undefined;
}

/**
 * Factory for building type-safe routes generators.
 *
 * Centralises routes walking and deprecation resolution so generator authors
 * only need to implement `processRoute` and `finalize`. Field-level deprecation
 * lives on the schemas themselves, read with `readDeprecation`.
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
        for (const { routeKey, route, routeTags } of flattenRoutes(contract.routes)) {
            processRoute({
                routeKey,
                route,
                routeTags,
                deprecated: route.deprecated !== undefined && route.deprecated !== false,
                deprecationMessage: typeof route.deprecated === 'string' ? route.deprecated : undefined,
            });
        }
        return finalize();
    };
