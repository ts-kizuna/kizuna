import type { z } from 'zod';
import {
    isFileSchema as coreIsFileSchema,
    readDiscriminatorLiteral as coreReadDiscriminatorLiteral,
    readMetaDescription as coreReadMetaDescription,
    readMetaId as coreReadMetaId,
    toPascalCase,
} from '@ts-kizuna/core/generator';

export interface KotlinField {
    name: string;
    wireName: string;
    type: string;
    optional: boolean;
    description?: string;
    isFile?: boolean;
    deprecated?: boolean;
    deprecationMessage?: string;
}

const KOTLIN_IDENTIFIER_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const sanitizeFieldName = (key: string): string => {
    if (KOTLIN_IDENTIFIER_REGEX.test(key)) return key;
    const segments = key.split(/[^A-Za-z0-9]+/).filter((segment) => segment.length > 0);
    const head = segments[0];
    if (head === undefined) return 'field';
    const headLower = head.charAt(0).toLowerCase() + head.slice(1);
    const camel =
        headLower +
        segments
            .slice(1)
            .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
            .join('');
    return /^[0-9]/.test(camel) ? `_${camel}` : camel;
};

export interface KotlinDataClass {
    kind: 'data-class';
    name: string;
    fields: KotlinField[];
    description?: string;
}

export interface KotlinEnumClass {
    kind: 'enum-class';
    name: string;
    cases: string[];
    description?: string;
}

export interface KotlinSealedClass {
    kind: 'sealed-class';
    name: string;
    discriminator: string;
    variants: Array<{
        caseName: string;
        literal: string;
        payloadType: string;
    }>;
    description?: string;
}

export type KotlinType = KotlinDataClass | KotlinEnumClass | KotlinSealedClass;

export interface MapResult {
    expression: string;
    optional: boolean;
    isFile?: boolean;
}

export class TypeRegistry {
    private readonly types = new Map<string, KotlinType>();
    private readonly warningSet = new Set<string>();
    private readonly explicitIds = new Set<string>();
    private readonly sealedVariantPayloads = new Set<string>();
    public usesJsonElement = false;

    has(name: string): boolean {
        return this.types.has(name);
    }

    add(type: KotlinType): void {
        if (this.types.has(type.name)) return;
        this.types.set(type.name, type);
    }

    replace(type: KotlinType): void {
        this.types.set(type.name, type);
    }

    all(): KotlinType[] {
        return Array.from(this.types.values());
    }

    markExplicitId(name: string): void {
        this.explicitIds.add(name);
    }

    isExplicitId(name: string): boolean {
        return this.explicitIds.has(name);
    }

    markSealedVariantPayload(name: string): void {
        this.sealedVariantPayloads.add(name);
    }

    isSealedVariantPayload(name: string): boolean {
        return this.sealedVariantPayloads.has(name);
    }

    warnJsonElement(hint: string, reason: string): void {
        this.usesJsonElement = true;
        this.warningSet.add(`${hint}: ${reason}`);
    }

    warnings(): string[] {
        return Array.from(this.warningSet);
    }
}

interface ZodDef {
    type?: string;
    innerType?: ZodSchema;
    element?: ZodSchema;
    shape?: Record<string, ZodSchema>;
    entries?: Record<string, string>;
    values?: unknown[];
    options?: ZodSchema[];
    discriminator?: string;
    checks?: Array<{ def?: { format?: string; check?: string } }>;
    format?: string;
    defaultValue?: unknown;
    valueType?: ZodSchema;
}

interface ZodSchema {
    def: ZodDef;
    _def?: ZodDef;
    shape?: Record<string, ZodSchema>;
    safeParse?: (value: unknown) => { success: boolean };
    meta?: () => Record<string, unknown> | undefined;
}

const accessDef = (schema: ZodSchema): ZodDef => schema.def ?? schema._def ?? {};

export const isFileSchema = (schema: ZodSchema): boolean => coreIsFileSchema(schema as unknown as z.ZodType);

export const readMetaId = (schema: ZodSchema): string | undefined => coreReadMetaId(schema as unknown as z.ZodType);

const readMetaDescription = (schema: ZodSchema): string | undefined => coreReadMetaDescription(schema as unknown as z.ZodType);

const INTEGER_FORMATS = ['safeint', 'int32', 'int64', 'int'];

const isIntegerNumber = (def: ZodDef): boolean => {
    if (INTEGER_FORMATS.includes(def.format as string)) return true;
    if (!def.checks) return false;
    return def.checks.some((check) => INTEGER_FORMATS.includes(check.def?.format as string));
};

const unwrapOptional = (schema: ZodSchema): { inner: ZodSchema; optional: boolean } => {
    let current = schema;
    let optional = false;
    while (true) {
        const def = accessDef(current);
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

const sanitizeIdentifier = (input: string): string => {
    const cleaned = input.replace(/[^a-zA-Z0-9_]/g, '_');
    return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
};

interface DiscriminatedDef {
    discriminator: string;
    options: ZodSchema[];
}

const readDiscriminatedUnion = (schema: ZodSchema): DiscriminatedDef | undefined => {
    const def = accessDef(schema);
    if (def.type !== 'union' || typeof def.discriminator !== 'string' || !Array.isArray(def.options)) return undefined;
    return {
        discriminator: def.discriminator,
        options: def.options,
    };
};

const readDiscriminatorLiteral = (variant: ZodSchema, propertyName: string): string | undefined => {
    const literal = coreReadDiscriminatorLiteral(variant as unknown as z.ZodType, propertyName);
    return typeof literal === 'string' ? literal : undefined;
};

const objectFields = (
    schema: ZodSchema,
    registry: TypeRegistry,
    hint: string,
    deprecatedPaths?: ReadonlyMap<string, string>,
    pathPrefix?: string,
    deprecationSchemas?: ReadonlyMap<string, Map<string, string>>,
    schemaDeprecations?: ReadonlyMap<string, string>
): KotlinField[] => {
    const shape = accessDef(schema).shape ?? schema.shape ?? {};
    const fields: KotlinField[] = [];
    const seen = new Map<string, string>();
    for (const [key, value] of Object.entries(shape)) {
        const childHint = `${hint}${toPascalCase(key)}`;
        const fieldPath = pathPrefix ? `${pathPrefix}.${key}` : key;
        const result = mapType(value, registry, childHint, deprecatedPaths, fieldPath, deprecationSchemas);
        const kotlinName = sanitizeFieldName(key);
        const previousWireName = seen.get(kotlinName);
        if (previousWireName !== undefined && previousWireName !== key) {
            throw new Error(
                `@ts-kizuna/kotlin: field key collision in ${hint} — ${stringify(previousWireName)} and ${stringify(key)} both sanitize to ${stringify(kotlinName)}.`
            );
        }
        seen.set(kotlinName, key);
        fields.push({
            name: kotlinName,
            wireName: key,
            type: result.expression,
            optional: result.optional,
            description: readMetaDescription(value),
            isFile: result.isFile,
            deprecated: deprecatedPaths?.has(fieldPath) === true || schemaDeprecations?.has(key) === true,
            deprecationMessage: deprecatedPaths?.get(fieldPath) || schemaDeprecations?.get(key) || undefined,
        });
    }
    return fields;
};

const stringify = (value: string): string => JSON.stringify(value);

export const mapType = (
    rawSchema: z.ZodType | ZodSchema,
    registry: TypeRegistry,
    hint: string,
    deprecatedPaths?: ReadonlyMap<string, string>,
    pathPrefix?: string,
    deprecationSchemas?: ReadonlyMap<string, Map<string, string>>
): MapResult => {
    const schema = rawSchema as ZodSchema;

    if (isFileSchema(schema)) {
        return {
            expression: 'MultipartFile',
            optional: false,
            isFile: true,
        };
    }

    const id = readMetaId(schema);
    const def = accessDef(schema);

    const discriminated = readDiscriminatedUnion(schema);
    if (discriminated) {
        const enumName = id ?? sanitizeIdentifier(toPascalCase(hint));
        if (id) registry.markExplicitId(enumName);
        if (!registry.has(enumName)) {
            registry.add({
                kind: 'sealed-class',
                name: enumName,
                discriminator: discriminated.discriminator,
                variants: [],
                description: readMetaDescription(schema),
            });
            const variants: KotlinSealedClass['variants'] = [];
            for (const option of discriminated.options) {
                const variantId = readMetaId(option);
                const literal = readDiscriminatorLiteral(option, discriminated.discriminator);
                const variantHint = variantId ?? `${enumName}${toPascalCase(literal ?? 'Variant')}`;
                const variantResult = mapType(option, registry, variantHint, undefined, undefined, deprecationSchemas);
                if (literal !== undefined) {
                    variants.push({
                        caseName: sanitizeCaseName(literal),
                        literal,
                        payloadType: variantResult.expression,
                    });
                }
            }
            for (const variant of variants) {
                registry.markSealedVariantPayload(variant.payloadType);
            }
            registry.replace({
                kind: 'sealed-class',
                name: enumName,
                discriminator: discriminated.discriminator,
                variants,
                description: readMetaDescription(schema),
            });
        }
        return {
            expression: enumName,
            optional: false,
        };
    }

    if (id && def.type === 'object') {
        registry.markExplicitId(id);
        if (!registry.has(id)) {
            registry.add({
                kind: 'data-class',
                name: id,
                fields: [],
                description: readMetaDescription(schema),
            });
            const fields = objectFields(schema, registry, id, deprecatedPaths, pathPrefix, deprecationSchemas, deprecationSchemas?.get(id));
            registry.replace({
                kind: 'data-class',
                name: id,
                fields,
                description: readMetaDescription(schema),
            });
        }
        return {
            expression: id,
            optional: false,
        };
    }

    const { inner, optional } = unwrapOptional(schema);
    if (optional) {
        const innerResult = mapType(inner, registry, hint, deprecatedPaths, pathPrefix, deprecationSchemas);
        return {
            expression: innerResult.expression.endsWith('?') ? innerResult.expression : `${innerResult.expression}?`,
            optional: true,
            isFile: innerResult.isFile,
        };
    }

    switch (def.type) {
        case 'void':
        case 'never':
            return {
                expression: 'Unit',
                optional: false,
            };
        case 'pipe': {
            const pipeDef = def as unknown as { in?: ZodSchema; out?: ZodSchema };
            const outDef = pipeDef.out as unknown as { _def?: { type?: string }; def?: { type?: string } } | undefined;
            const outType = outDef?._def?.type ?? outDef?.def?.type;
            if (pipeDef.out && outType !== 'transform') {
                return mapType(pipeDef.out, registry, hint, deprecatedPaths, pathPrefix, deprecationSchemas);
            }
            if (pipeDef.in) return mapType(pipeDef.in, registry, hint, deprecatedPaths, pathPrefix, deprecationSchemas);
            registry.warnJsonElement(hint, 'pipe schema missing resolvable type');
            return {
                expression: 'JsonElement',
                optional: false,
            };
        }
        case 'string': {
            const isDatetime =
                def.format === 'datetime' ||
                (def.checks as Array<{ format?: string }> | undefined)?.some((check) => check.format === 'datetime');
            return {
                expression: isDatetime ? 'Instant' : 'String',
                optional: false,
            };
        }
        case 'number':
            return {
                expression: isIntegerNumber(def) ? 'Int' : 'Double',
                optional: false,
            };
        case 'bigint':
            return {
                expression: 'Long',
                optional: false,
            };
        case 'boolean':
            return {
                expression: 'Boolean',
                optional: false,
            };
        case 'date':
            return {
                expression: 'Instant',
                optional: false,
            };
        case 'array': {
            const element = def.element;
            if (!element) {
                registry.warnJsonElement(hint, 'array element schema missing');
                return {
                    expression: 'List<JsonElement>',
                    optional: false,
                };
            }
            const elementResult = mapType(element, registry, `${hint}Item`, deprecatedPaths, pathPrefix, deprecationSchemas);
            return {
                expression: `List<${elementResult.expression.replace(/\?$/, '')}>`,
                optional: false,
            };
        }
        case 'object': {
            const className = sanitizeIdentifier(toPascalCase(hint));
            if (!registry.has(className)) {
                registry.add({
                    kind: 'data-class',
                    name: className,
                    fields: [],
                    description: readMetaDescription(schema),
                });
                const fields = objectFields(schema, registry, className, deprecatedPaths, pathPrefix, deprecationSchemas);
                registry.replace({
                    kind: 'data-class',
                    name: className,
                    fields,
                    description: readMetaDescription(schema),
                });
            }
            return {
                expression: className,
                optional: false,
            };
        }
        case 'enum': {
            const enumName = sanitizeIdentifier(toPascalCase(hint));
            const entries = def.entries ?? {};
            const cases = Object.values(entries);
            if (!registry.has(enumName)) {
                registry.add({
                    kind: 'enum-class',
                    name: enumName,
                    cases,
                    description: readMetaDescription(schema),
                });
            }
            return {
                expression: enumName,
                optional: false,
            };
        }
        case 'literal': {
            const values = def.values ?? [];
            if (values.every((value) => typeof value === 'string')) {
                return {
                    expression: 'String',
                    optional: false,
                };
            }
            if (values.every((value) => typeof value === 'number')) {
                return {
                    expression: 'Double',
                    optional: false,
                };
            }
            if (values.every((value) => typeof value === 'boolean')) {
                return {
                    expression: 'Boolean',
                    optional: false,
                };
            }
            registry.warnJsonElement(hint, 'literal of mixed types');
            return {
                expression: 'JsonElement',
                optional: false,
            };
        }
        case 'union': {
            const options = def.options ?? [];
            const allStringLiterals = options.every((option) => {
                const optionDef = accessDef(option);
                return optionDef.type === 'literal' && (optionDef.values ?? []).every((value) => typeof value === 'string');
            });
            if (allStringLiterals) {
                return {
                    expression: 'String',
                    optional: false,
                };
            }
            const resolved = options
                .map((option) => mapType(option as ZodSchema, registry, hint, deprecatedPaths, pathPrefix, deprecationSchemas))
                .filter((result): result is MapResult => result !== undefined && result.expression !== 'JsonElement');
            if (resolved.length === 0) {
                registry.warnJsonElement(hint, 'non-discriminated union');
                return { expression: 'JsonElement', optional: false };
            }
            const expressions = resolved.map((result) => result.expression);
            const unique = [...new Set(expressions)];
            if (unique.length === 1) {
                return resolved[0]!;
            }
            const listPattern = /^List<(.+)>$/;
            const baseTypes = unique.map((expression) => {
                const match = listPattern.exec(expression);
                return match ? match[1] : expression;
            });
            if (new Set(baseTypes).size === 1) {
                return {
                    expression: `List<${baseTypes[0]}>`,
                    optional: false,
                };
            }
            registry.warnJsonElement(hint, 'non-discriminated union');
            return {
                expression: 'JsonElement',
                optional: false,
            };
        }
        case 'record': {
            const valueType = def.valueType;
            if (valueType) {
                const valueResult = mapType(valueType, registry, `${hint}Value`);
                return {
                    expression: `Map<String, ${valueResult.expression.replace(/\?$/, '')}>`,
                    optional: false,
                };
            }
            registry.warnJsonElement(hint, 'record without value schema');
            return {
                expression: 'Map<String, JsonElement>',
                optional: false,
            };
        }
        case 'any':
        case 'unknown':
            registry.warnJsonElement(hint, `${def.type} schema`);
            return {
                expression: 'JsonElement',
                optional: false,
            };
        default:
            registry.warnJsonElement(hint, `unhandled schema type: ${def.type ?? 'unknown'}`);
            return {
                expression: 'JsonElement',
                optional: false,
            };
    }
};

const sanitizeCaseName = (literal: string): string => {
    const cleaned = literal.replace(/[^a-zA-Z0-9_]/g, '_');
    if (!cleaned) return 'value';
    if (/^[0-9]/.test(cleaned)) return `_${cleaned}`;
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
};

export const collectObjectFields = (
    schema: z.ZodType | ZodSchema,
    registry: TypeRegistry,
    hint: string,
    deprecatedPaths?: ReadonlyMap<string, string>,
    pathPrefix?: string,
    deprecationSchemas?: ReadonlyMap<string, Map<string, string>>
): KotlinField[] => {
    return objectFields(schema as ZodSchema, registry, hint, deprecatedPaths, pathPrefix, deprecationSchemas);
};

export const isObjectSchema = (schema: z.ZodType | ZodSchema): boolean => {
    return accessDef(schema as ZodSchema).type === 'object';
};

export const isDiscriminatedUnionSchema = (schema: z.ZodType | ZodSchema): boolean => {
    return readDiscriminatedUnion(schema as ZodSchema) !== undefined;
};

export const objectFieldCount = (schema: z.ZodType | ZodSchema): number => {
    const shape = accessDef(schema as ZodSchema).shape ?? (schema as ZodSchema).shape ?? {};
    return Object.keys(shape).length;
};

export const objectShapeKeys = (schema: z.ZodType | ZodSchema): Array<{ name: string; wireName: string; isFile: boolean }> => {
    const shape = accessDef(schema as ZodSchema).shape ?? (schema as ZodSchema).shape ?? {};
    return Object.entries(shape).map(([key, value]) => ({
        name: sanitizeFieldName(key),
        wireName: key,
        isFile: isFileSchema(value as ZodSchema),
    }));
};
