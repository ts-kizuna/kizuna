import type { z } from 'zod';
import {
    isFileSchema as coreIsFileSchema,
    readDiscriminatorLiteral as coreReadDiscriminatorLiteral,
    readMetaDescription as coreReadMetaDescription,
    readMetaId as coreReadMetaId,
} from '@ts-kizuna/core/generator';
import { pascalCase } from './emit.js';

export interface SwiftField {
    name: string;
    wireName: string;
    type: string;
    optional: boolean;
    description?: string;
    isFile?: boolean;
    deprecated?: boolean;
    deprecationMessage?: string;
}

const SWIFT_IDENTIFIER_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const sanitizeFieldName = (key: string): string => {
    if (SWIFT_IDENTIFIER_REGEX.test(key)) return key;
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

export interface SwiftStruct {
    kind: 'struct';
    name: string;
    fields: SwiftField[];
    description?: string;
}

export interface SwiftStringEnum {
    kind: 'enum';
    name: string;
    cases: string[];
    description?: string;
}

export interface SwiftDiscriminatedEnum {
    kind: 'discriminated-enum';
    name: string;
    discriminator: string;
    variants: Array<{
        caseName: string;
        literal: string;
        payloadType: string;
    }>;
    description?: string;
}

export type SwiftType = SwiftStruct | SwiftStringEnum | SwiftDiscriminatedEnum;

export interface MapResult {
    expression: string;
    optional: boolean;
    isFile?: boolean;
}

export class TypeRegistry {
    private readonly types = new Map<string, SwiftType>();
    private readonly warningSet = new Set<string>();
    private readonly explicitIds = new Set<string>();
    public usesAnyCodable = false;

    has(name: string): boolean {
        return this.types.has(name);
    }

    get(name: string): SwiftType | undefined {
        return this.types.get(name);
    }

    add(type: SwiftType): void {
        if (this.types.has(type.name)) return;
        this.types.set(type.name, type);
    }

    replace(type: SwiftType): void {
        this.types.set(type.name, type);
    }

    all(): SwiftType[] {
        return Array.from(this.types.values());
    }

    markExplicitId(name: string): void {
        this.explicitIds.add(name);
    }

    isExplicitId(name: string): boolean {
        return this.explicitIds.has(name);
    }

    warnAnyCodable(hint: string, reason: string): void {
        this.usesAnyCodable = true;
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
): SwiftField[] => {
    const shape = accessDef(schema).shape ?? schema.shape ?? {};
    const fields: SwiftField[] = [];
    const seen = new Map<string, string>();
    for (const [key, value] of Object.entries(shape)) {
        const childHint = `${hint}${pascalCase(key)}`;
        const fieldPath = pathPrefix ? `${pathPrefix}.${key}` : key;
        const result = mapType(value, registry, childHint, deprecatedPaths, fieldPath, deprecationSchemas);
        const swiftName = sanitizeFieldName(key);
        const previousWireName = seen.get(swiftName);
        if (previousWireName !== undefined && previousWireName !== key) {
            throw new Error(
                `@ts-kizuna/swift: field key collision in ${hint} — ${stringify(previousWireName)} and ${stringify(key)} both sanitize to ${stringify(swiftName)}.`
            );
        }
        seen.set(swiftName, key);
        fields.push({
            name: swiftName,
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

    // Discriminated union
    const discriminated = readDiscriminatedUnion(schema);
    if (discriminated) {
        const enumName = id ?? sanitizeIdentifier(pascalCase(hint));
        if (id) registry.markExplicitId(enumName);
        if (!registry.has(enumName)) {
            // placeholder to prevent recursion
            registry.add({
                kind: 'discriminated-enum',
                name: enumName,
                discriminator: discriminated.discriminator,
                variants: [],
                description: readMetaDescription(schema),
            });
            const variants: SwiftDiscriminatedEnum['variants'] = [];
            for (const option of discriminated.options) {
                const variantId = readMetaId(option);
                const literal = readDiscriminatorLiteral(option, discriminated.discriminator);
                const variantHint = variantId ?? `${enumName}${pascalCase(literal ?? 'Variant')}`;
                const variantResult = mapType(option, registry, variantHint, undefined, undefined, deprecationSchemas);
                if (literal !== undefined) {
                    variants.push({
                        caseName: sanitizeCaseName(literal),
                        literal,
                        payloadType: variantResult.expression,
                    });
                }
            }
            registry.replace({
                kind: 'discriminated-enum',
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
                kind: 'struct',
                name: id,
                fields: [],
                description: readMetaDescription(schema),
            });
            const fields = objectFields(schema, registry, id, deprecatedPaths, pathPrefix, deprecationSchemas, deprecationSchemas?.get(id));
            registry.replace({
                kind: 'struct',
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
                expression: 'Void',
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
            registry.warnAnyCodable(hint, 'pipe schema missing resolvable type');
            return {
                expression: 'AnyCodable',
                optional: false,
            };
        }
        case 'string': {
            const isDatetime =
                def.format === 'datetime' ||
                (def.checks as Array<{ format?: string }> | undefined)?.some((check) => check.format === 'datetime');
            return {
                expression: isDatetime ? 'Date' : 'String',
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
                expression: 'Int64',
                optional: false,
            };
        case 'boolean':
            return {
                expression: 'Bool',
                optional: false,
            };
        case 'date':
            return {
                expression: 'Date',
                optional: false,
            };
        case 'array': {
            const element = def.element;
            if (!element) {
                registry.warnAnyCodable(hint, 'array element schema missing');
                return {
                    expression: '[AnyCodable]',
                    optional: false,
                };
            }
            const elementResult = mapType(element, registry, `${hint}Item`, deprecatedPaths, pathPrefix, deprecationSchemas);
            return {
                expression: `[${elementResult.expression.replace(/\?$/, '')}]`,
                optional: false,
            };
        }
        case 'object': {
            const structName = sanitizeIdentifier(pascalCase(hint));
            if (!registry.has(structName)) {
                registry.add({
                    kind: 'struct',
                    name: structName,
                    fields: [],
                    description: readMetaDescription(schema),
                });
                const fields = objectFields(schema, registry, structName, deprecatedPaths, pathPrefix, deprecationSchemas);
                registry.replace({
                    kind: 'struct',
                    name: structName,
                    fields,
                    description: readMetaDescription(schema),
                });
            }
            return {
                expression: structName,
                optional: false,
            };
        }
        case 'enum': {
            const enumName = sanitizeIdentifier(pascalCase(hint));
            const entries = def.entries ?? {};
            const cases = Object.values(entries);
            if (!registry.has(enumName)) {
                registry.add({
                    kind: 'enum',
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
                    expression: 'Bool',
                    optional: false,
                };
            }
            registry.warnAnyCodable(hint, 'literal of mixed types');
            return {
                expression: 'AnyCodable',
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
                .filter((result): result is MapResult => result !== undefined && result.expression !== 'AnyCodable');
            if (resolved.length === 0) {
                registry.warnAnyCodable(hint, 'non-discriminated union');
                return { expression: 'AnyCodable', optional: false };
            }
            const expressions = resolved.map((result) => result.expression);
            const unique = [...new Set(expressions)];
            if (unique.length === 1) {
                return resolved[0]!;
            }
            const arrayPattern = /^\[(.+)\]$/;
            const baseTypes = unique.map((expression) => {
                const match = arrayPattern.exec(expression);
                return match ? match[1] : expression;
            });
            if (new Set(baseTypes).size === 1) {
                return {
                    expression: `[${baseTypes[0]}]`,
                    optional: false,
                };
            }
            registry.warnAnyCodable(hint, 'non-discriminated union');
            return {
                expression: 'AnyCodable',
                optional: false,
            };
        }
        case 'record': {
            const valueType = def.valueType;
            if (valueType) {
                const valueResult = mapType(valueType, registry, `${hint}Value`);
                return {
                    expression: `[String: ${valueResult.expression.replace(/\?$/, '')}]`,
                    optional: false,
                };
            }
            registry.warnAnyCodable(hint, 'record without value schema');
            return {
                expression: '[String: AnyCodable]',
                optional: false,
            };
        }
        case 'any':
        case 'unknown':
            registry.warnAnyCodable(hint, `${def.type} schema`);
            return {
                expression: 'AnyCodable',
                optional: false,
            };
        default:
            registry.warnAnyCodable(hint, `unhandled schema type: ${def.type ?? 'unknown'}`);
            return {
                expression: 'AnyCodable',
                optional: false,
            };
    }
};

const sanitizeCaseName = (literal: string): string => {
    const cleaned = literal.replace(/[^a-zA-Z0-9_]/g, '_');
    if (!cleaned) return 'value';
    if (/^[0-9]/.test(cleaned)) return `_${cleaned}`;
    return cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
};

export const collectObjectFields = (
    schema: z.ZodType | ZodSchema,
    registry: TypeRegistry,
    hint: string,
    deprecatedPaths?: ReadonlyMap<string, string>,
    pathPrefix?: string,
    deprecationSchemas?: ReadonlyMap<string, Map<string, string>>
): SwiftField[] => {
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
