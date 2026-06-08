import type { z } from 'zod';
import {
    createDeprecationMap,
    resolveDeprecationMap,
    serializeDeprecationMap,
    deserializeDeprecationMap,
    type DeprecationMap,
    type SerializedDeprecationMap,
} from './deprecation.js';
import { flattenContract } from './handler-pipeline.js';
import { parsePath } from './path-params.js';
import type { Contract, ResponseDefinition, RouteDefinition } from './types.js';

export {
    createDeprecationMap,
    resolveDeprecationMap,
    serializeDeprecationMap,
    deserializeDeprecationMap,
    type DeprecationMap,
    type SerializedDeprecationMap,
};
export type { Contract, RouteDefinition };
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
    globalRegistrySchemas,
    unwrapOptionalWrappers,
    type ZodDef,
    type DiscriminatedUnion,
} from './zod-internals.js';

export const resolveResponseBody = (value: ResponseDefinition): z.ZodType =>
    value && typeof value === 'object' && 'body' in value ? value.body : (value as z.ZodType);

export const resolveResponseHeaders = (value: ResponseDefinition): z.ZodType | undefined =>
    value && typeof value === 'object' && 'body' in value ? value.headers : undefined;

export const resolveResponseContentType = (value: ResponseDefinition | undefined): string | undefined =>
    value && typeof value === 'object' && 'body' in value ? value.contentType : undefined;

/**
 * Whether a media type is JSON-serialized: `application/json` or any
 * structured-suffix `+json` type (e.g. `application/problem+json`). Any other
 * type carries a raw body that is written/read as-is.
 */
export const isJsonMediaType = (contentType: string): boolean => {
    const essence = (contentType.split(';')[0] ?? '').trim().toLowerCase();
    return essence === 'application/json' || essence.endsWith('+json');
};

/**
 * Controls how `@deprecated` JSDoc tags in the contract source are surfaced
 * in generated output (OpenAPI `deprecated: true`, Swift `@available`).
 *
 * Three forms:
 * - `{ contractPath: string }` — parse live from the `.ts` source file.
 * - `DeprecationMap` — pre-computed Maps (from `createDeprecationMap`).
 * - `SerializedDeprecationMap` — plain JSON import (from the tsdown plugin).
 *
 * ```ts
 * // From source (dev / build):
 * deprecationWarnings: { contractPath: path.resolve(import.meta.dirname, './contract.ts') }
 *
 * // From JSON (production):
 * import deprecations from './deprecations.json';
 * deprecationWarnings: deprecations
 * ```
 */
export type DeprecationWarnings = { contractPath: string } | DeprecationMap | SerializedDeprecationMap;

export interface GeneratorOptions {
    deprecationWarnings?: DeprecationWarnings;
}

export interface GeneratorRouteContext {
    routeKey: string;
    route: RouteDefinition;
    contractTags: string[];
    /**
     * Whether this route is marked `@deprecated` in the contract source.
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
 * Factory for building type-safe contract generators.
 *
 * Centralises contract walking and deprecation resolution so generator authors
 * only need to implement `processRoute` and `finalize`.
 *
 * ```ts
 * const generateRouteList = createGenerator((options: GeneratorOptions) => {
 *     const routes: string[] = [];
 *     return {
 *         processRoute({ routeKey, route, deprecated }) {
 *             routes.push(`${route.method} ${route.path}${deprecated ? ' (deprecated)' : ''}`);
 *         },
 *         finalize() {
 *             return routes;
 *         },
 *     };
 * });
 *
 * const list = generateRouteList(contract, {});
 * ```
 */
export const createGenerator =
    <Options extends GeneratorOptions, Output>(
        factory: (options: Options) => {
            processRoute: (context: GeneratorRouteContext) => void;
            finalize: () => Output;
        }
    ): ((contract: Contract, options: Options) => Output) =>
    (contract, options) => {
        const { processRoute, finalize } = factory(options);
        const deprecation = resolveDeprecationMap(options.deprecationWarnings);
        for (const { routeKey, route, contractTags } of flattenContract(contract)) {
            const rawMessage = deprecation?.routes.get(routeKey);
            processRoute({
                routeKey,
                route,
                contractTags,
                deprecated: rawMessage !== undefined,
                deprecationMessage: rawMessage || undefined,
                fieldDeprecations: deprecation?.fields.get(routeKey),
            });
        }
        return finalize();
    };
