import { z } from 'zod';

/**
 * Shape of a schema's internal `_zod.def`, narrowed to the fields ts-kizuna reads.
 */
export interface ZodDef {
    type?: string;
    innerType?: z.core.$ZodType;
    element?: z.core.$ZodType;
    in?: z.core.$ZodType;
    out?: z.core.$ZodType;
    shape?: Record<string, z.core.$ZodType>;
    entries?: Record<string, string>;
    values?: unknown[];
    options?: z.core.$ZodType[];
    discriminator?: string;
    checks?: Array<{
        format?: string;
        def?: {
            format?: string;
            check?: string;
        };
    }>;
    format?: string;
    defaultValue?: unknown;
    valueType?: z.core.$ZodType;
}

/**
 * Reads a schema's internal `_zod.def`.
 */
export const readDef = (schema: z.core.$ZodType): ZodDef => schema._zod.def as ZodDef;

/**
 * Returns the schema's kind (`'string'`, `'object'`, `'optional'`, `'void'`, …).
 */
export const readDefType = (schema: z.core.$ZodType): string | undefined => readDef(schema).type;

/**
 * True for `z.void()` schemas.
 */
export const isVoidSchema = (schema: z.core.$ZodType): boolean => readDefType(schema) === 'void';

/**
 * True for `z.object()` schemas.
 */
export const isObjectSchema = (schema: z.core.$ZodType): boolean => readDefType(schema) === 'object';

const INTEGER_FORMATS: ReadonlySet<string> = new Set(['safeint', 'int32', 'int64', 'int']);

/**
 * True for integer-formatted number schemas (`z.int()`, `.int()`, int32/64, …).
 */
export const isIntegerSchema = (schema: z.core.$ZodType): boolean => {
    const def = readDef(schema);
    if (def.format !== undefined && INTEGER_FORMATS.has(def.format)) return true;
    return def.checks?.some((check) => check.def?.format !== undefined && INTEGER_FORMATS.has(check.def.format)) ?? false;
};

/**
 * Returns the field map of an object schema, or undefined for non-objects.
 */
export const readObjectShape = (schema: z.core.$ZodType): Record<string, z.core.$ZodType> | undefined => readDef(schema).shape;

/**
 * Schema kinds that wrap an `innerType` (`optional`, `nullable`, `default`, …).
 */
export const WRAPPER_TYPES: ReadonlySet<string> = new Set([
    'optional',
    'nullable',
    'default',
    'prefault',
    'catch',
    'nonoptional',
    'success',
    'readonly',
]);

/**
 * Removes optional/nullable/default wrappers, returning the inner schema and
 * whether any were present.
 */
export const unwrapOptionalWrappers = (schema: z.core.$ZodType): { inner: z.core.$ZodType; optional: boolean } => {
    let current = schema;
    let optional = false;
    while (true) {
        const def = readDef(current);
        if (def.type !== 'optional' && def.type !== 'nullable' && def.type !== 'default' && def.type !== 'nullish') break;
        optional = true;
        const next = def.innerType;
        if (!next) break;
        current = next;
    }
    return {
        inner: current,
        optional,
    };
};

export interface DiscriminatedUnion {
    discriminator: string;
    options: z.core.$ZodType[];
}

/**
 * Reads the discriminator and variants of a discriminated-union schema, or
 * undefined for any other schema.
 */
export const readDiscriminatedUnion = (schema: z.core.$ZodType): DiscriminatedUnion | undefined => {
    const def = readDef(schema);
    if (def.type !== 'union' || typeof def.discriminator !== 'string' || !Array.isArray(def.options)) return undefined;
    return {
        discriminator: def.discriminator,
        options: def.options,
    };
};

/**
 * True for `z.discriminatedUnion()` schemas.
 */
export const isDiscriminatedUnionSchema = (schema: z.core.$ZodType): boolean => readDiscriminatedUnion(schema) !== undefined;

/**
 * Returns the literal value of `propertyName` on a discriminated-union variant,
 * or undefined when it is absent or not a single literal.
 */
export const readDiscriminatorLiteral = (variant: z.core.$ZodType, propertyName: string): string | number | undefined => {
    const field = readObjectShape(variant)?.[propertyName];
    if (!field) return undefined;
    const values = readDef(field).values;
    if (Array.isArray(values) && values.length === 1) {
        const value = values[0];
        if (typeof value === 'string' || typeof value === 'number') return value;
    }
    return undefined;
};

/**
 * A `File` instance used to probe schemas, or null when `File` is unavailable.
 */
export const FILE_PROBE: unknown = typeof File !== 'undefined' ? new File([''], 'probe') : null;

/**
 * True for `z.instanceof(File)`-style custom schemas. Probes with a real File
 * and a string so other `custom` schemas are not matched.
 */
export const isFileSchema = (schema: z.core.$ZodType): boolean => {
    if (FILE_PROBE === null) return false;
    if (readDefType(schema) !== 'custom') return false;
    return z.core.safeParse(schema, FILE_PROBE).success && !z.core.safeParse(schema, 'not-a-file').success;
};

/**
 * Returns a schema's metadata (set via `.meta()`), or undefined.
 */
export const readMeta = (schema: z.core.$ZodType): Record<string, unknown> | undefined =>
    z.core.globalRegistry.get(schema) as Record<string, unknown> | undefined;

/**
 * Returns a schema's `id` metadata, or undefined.
 */
export const readMetaId = (schema: z.core.$ZodType): string | undefined => {
    const id = readMeta(schema)?.id;
    return typeof id === 'string' ? id : undefined;
};

/**
 * Returns a schema's `description` metadata, or undefined.
 */
export const readMetaDescription = (schema: z.core.$ZodType): string | undefined => {
    const description = readMeta(schema)?.description;
    return typeof description === 'string' ? description : undefined;
};

/**
 * The global registry's schemas, keyed by their `id`.
 */
export const globalRegistrySchemas = (): Map<string, z.core.$ZodType> =>
    (z.core.globalRegistry as unknown as { _idmap: Map<string, z.core.$ZodType> })._idmap;
