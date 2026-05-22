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
import type { Contract, RouteDefinition } from './types.js';

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

interface ZodInternals {
    def?: {
        type?: string;
        values?: unknown;
    };
    _def?: {
        type?: string;
        values?: unknown;
    };
    shape?: Record<string, z.ZodType>;
    safeParse?: (value: unknown) => { success: boolean };
    meta?: () => Record<string, unknown> | undefined;
}

const accessDef = (schema: z.ZodType): { type?: string; values?: unknown } => {
    const internals = schema as unknown as ZodInternals;
    return internals.def ?? internals._def ?? {};
};

/**
 * Probe value used to detect `z.instanceof(File)` schemas at runtime.
 *
 * Zod 4's `z.instanceof(File)` is an opaque `custom` schema — `_def` carries
 * no reference back to the constructor — so the only reliable way to ask
 * "does this schema accept a File?" is to safeParse a real File against it.
 */
export const FILE_PROBE: unknown = typeof File !== 'undefined' ? new File([''], 'probe') : null;

/**
 * Returns true if `schema` is a `z.instanceof(File)`-style custom schema.
 *
 * Uses a double probe — accept a File, reject a string — so that other
 * `custom` schemas (anything else built on `z.custom(...)`) are not
 * misidentified as file fields.
 */
export const isFileSchema = (schema: z.ZodType): boolean => {
    if (FILE_PROBE === null) return false;
    const internals = schema as unknown as ZodInternals;
    if (accessDef(schema).type !== 'custom') return false;
    if (typeof internals.safeParse !== 'function') return false;
    return schema.safeParse(FILE_PROBE).success && !schema.safeParse('not-a-file').success;
};

export const readMeta = (schema: z.ZodType): Record<string, unknown> | undefined => {
    return (schema as unknown as ZodInternals).meta?.();
};

export const readMetaId = (schema: z.ZodType): string | undefined => {
    const id = readMeta(schema)?.id;
    return typeof id === 'string' ? id : undefined;
};

export const readMetaDescription = (schema: z.ZodType): string | undefined => {
    const description = readMeta(schema)?.description;
    return typeof description === 'string' ? description : undefined;
};

export const resolveResponseBody = (value: z.ZodType | { body: z.ZodType; headers?: z.ZodType }): z.ZodType =>
    value && typeof value === 'object' && 'body' in value ? value.body : (value as z.ZodType);

export const resolveResponseHeaders = (value: z.ZodType | { body: z.ZodType; headers?: z.ZodType }): z.ZodType | undefined =>
    value && typeof value === 'object' && 'body' in value ? value.headers : undefined;

/**
 * Pulls the literal value of `propertyName` out of a discriminated-union
 * variant. Returns undefined when the property is absent or carries more
 * than one literal value.
 */
export const readDiscriminatorLiteral = (variant: z.ZodType, propertyName: string): string | number | undefined => {
    const internals = variant as unknown as ZodInternals;
    const def = accessDef(variant) as unknown as { shape?: Record<string, z.ZodType> };
    const shape = def.shape ?? internals.shape;
    const field = shape?.[propertyName];
    if (!field) return undefined;
    const values = accessDef(field).values;
    if (Array.isArray(values) && values.length === 1) {
        const value = values[0];
        if (typeof value === 'string' || typeof value === 'number') return value;
    }
    return undefined;
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
