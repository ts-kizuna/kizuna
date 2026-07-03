import { z } from 'zod';

/**
 * Shape of a schema's internal `_zod.def`, narrowed to the fields ts-kizuna reads.
 */
export interface ZodDef {
    type?: string;
    coerce?: boolean;
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

/**
 * Returns the dotted path to the first `z.coerce` schema in the tree (`''` if the
 * root itself is coerced), or `undefined` if there is none. Descends fields,
 * elements, wrappers, pipes, and unions; the `WeakSet` guards against `z.lazy`
 * cycles.
 */
export const findCoercedSchemaPath = (schema: z.core.$ZodType, path = '', seen: WeakSet<object> = new WeakSet()): string | undefined => {
    if (seen.has(schema)) return undefined;
    seen.add(schema);
    const def = readDef(schema);
    if (def.coerce === true) return path;
    if (def.shape) {
        for (const [key, field] of Object.entries(def.shape)) {
            const found = findCoercedSchemaPath(field, path ? `${path}.${key}` : key, seen);
            if (found !== undefined) return found;
        }
    }
    const children: Array<z.core.$ZodType | undefined> = [def.innerType, def.element, def.in, def.out, def.valueType];
    for (const child of children) {
        if (!child) continue;
        const found = findCoercedSchemaPath(child, path, seen);
        if (found !== undefined) return found;
    }
    if (Array.isArray(def.options)) {
        for (const option of def.options) {
            const found = findCoercedSchemaPath(option, path, seen);
            if (found !== undefined) return found;
        }
    }
    return undefined;
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
 * Returns the literal value of `propertyName` on a discriminated-union variant,
 * or undefined when it is absent, not a single literal, or not a string.
 */
export const readDiscriminatorStringLiteral = (variant: z.core.$ZodType, propertyName: string): string | undefined => {
    const literal = readDiscriminatorLiteral(variant, propertyName);
    return typeof literal === 'string' ? literal : undefined;
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
 * A `Uint8Array` instance used to probe schemas.
 */
export const BINARY_PROBE: Uint8Array = new Uint8Array();

/**
 * True for `z.instanceof(Uint8Array)`-style custom schemas (the `BinarySchema`
 * helper). Probes with a real `Uint8Array` and a string so other `custom`
 * schemas — including `z.instanceof(File)` — are not matched.
 */
export const isBinarySchema = (schema: z.core.$ZodType): boolean => {
    if (readDefType(schema) !== 'custom') return false;
    if (isFileSchema(schema)) return false;
    return z.core.safeParse(schema, BINARY_PROBE).success && !z.core.safeParse(schema, 'not-a-uint8array').success;
};

/**
 * Returns a schema's metadata (set via `.meta()`), or undefined.
 */
export const readMeta = (schema: z.core.$ZodType): Record<string, unknown> | undefined =>
    z.core.globalRegistry.get(schema) as Record<string, unknown> | undefined;

const modelSchemas = new WeakSet<z.core.$ZodType>();

/**
 * Marks a schema as a `createModel` model.
 */
export const markModelSchema = (schema: z.core.$ZodType): void => {
    modelSchemas.add(schema);
};

/**
 * Returns a `createModel` schema's `id` metadata, or undefined.
 */
export const readMetaId = (schema: z.core.$ZodType): string | undefined => {
    if (!modelSchemas.has(schema)) return undefined;
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
 * The `createModel` schemas in the global registry, keyed by their `id`.
 */
export const globalRegistrySchemas = (): Map<string, z.core.$ZodType> => {
    const idMap = (z.core.globalRegistry as unknown as { _idmap: Map<string, z.core.$ZodType> })._idmap;
    return new Map(Array.from(idMap).filter(([, schema]) => modelSchemas.has(schema)));
};
