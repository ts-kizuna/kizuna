import type { z } from 'zod';
import {
    isFileSchema,
    isUrlSchema,
    isIntegerSchema,
    readDef,
    readDefType,
    readDiscriminatedUnion,
    readDiscriminatorStringLiteral,
    readDeprecation,
    readMetaDescription,
    readMetaId,
    readObjectShape,
    unwrapOptionalWrappers,
    toPascalCase,
    toCamelCase,
    sanitizeFieldName,
    sanitizeIdentifier,
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

export interface KotlinDataClass {
    kind: 'data-class';
    name: string;
    fields: KotlinField[];
    description?: string;
    /**
     * The sealed interface this class implements as a discriminated-union member.
     */
    sealedParent?: string;
    /**
     * The discriminator value that selects this member.
     */
    serialName?: string;
    /**
     * The discriminator field to omit from the emitted class.
     */
    discriminatorWireName?: string;
}

export interface KotlinEnumClass {
    kind: 'enum-class';
    name: string;
    cases: string[];
    description?: string;
    unknownCase: boolean;
}

export interface KotlinSealedClass {
    kind: 'sealed-class';
    name: string;
    discriminator: string;
    variants: Array<{
        caseName: string;
        literal: string;
        payloadType: string;
        // Anonymous members nest inside the interface; named models emit top-level.
        nested: boolean;
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
    private readonly sealedVariantPaths = new Map<string, string>();
    public usesJsonElement = false;

    constructor(
        public readonly camelCaseProperties = false,
        public readonly unknownEnumCase = false
    ) {}

    has(name: string): boolean {
        return this.types.has(name);
    }

    get(name: string): KotlinType | undefined {
        return this.types.get(name);
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

    /**
     * An inlined sealed variant has no class of its own, so references to it go through the sealed
     * interface: `UserSessionEvent.Logout`.
     */
    markSealedVariantPath(name: string, path: string): void {
        this.sealedVariantPaths.set(name, path);
    }

    sealedVariantPath(name: string): string | undefined {
        return this.sealedVariantPaths.get(name);
    }

    warnJsonElement(hint: string, reason: string): void {
        this.usesJsonElement = true;
        this.warningSet.add(`${hint}: ${reason}`);
    }

    warnings(): string[] {
        return Array.from(this.warningSet);
    }
}

/**
 * The Kotlin property name for a wire key: verbatim, or camelCased under
 * `camelCaseProperties`.
 */
const propertyName = (key: string, camelCase: boolean): string => {
    if (!camelCase) return sanitizeFieldName(key);
    const camel = toCamelCase(key);
    if (!camel) return 'field';
    return /^[0-9]/.test(camel) ? `_${camel}` : camel;
};

const objectFields = (schema: z.core.$ZodType, registry: TypeRegistry, hint: string): KotlinField[] => {
    const shape = readObjectShape(schema) ?? {};
    const fields: KotlinField[] = [];
    const seen = new Map<string, string>();
    for (const [key, value] of Object.entries(shape)) {
        const childHint = `${hint}${toPascalCase(key)}`;
        const result = mapType(value, registry, childHint);
        const deprecation = readDeprecation(value);
        const kotlinName = propertyName(key, registry.camelCaseProperties);
        const previousWireName = seen.get(kotlinName);
        if (previousWireName !== undefined && previousWireName !== key) {
            throw new Error(
                `@ts-kizuna/kotlin: field key collision in ${hint}, ${stringify(previousWireName)} and ${stringify(key)} both sanitize to ${stringify(kotlinName)}.`
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
            deprecated: deprecation !== undefined,
            deprecationMessage: deprecation?.message,
        });
    }
    return fields;
};

const stringify = (value: string): string => JSON.stringify(value);

export const mapType = (schema: z.core.$ZodType, registry: TypeRegistry, hint: string): MapResult => {
    if (isFileSchema(schema)) {
        return {
            expression: 'MultipartFile',
            optional: false,
            isFile: true,
        };
    }

    if (isUrlSchema(schema)) {
        // java.net.URI has no kotlinx serializer, so the wire string stays a String.
        return {
            expression: 'String',
            optional: false,
        };
    }

    const id = readMetaId(schema);
    const def = readDef(schema);

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
                const literal = readDiscriminatorStringLiteral(option, discriminated.discriminator);
                const variantHint = variantId ?? `${enumName}${toPascalCase(literal ?? 'Variant')}`;
                const variantResult = mapType(option, registry, variantHint);
                if (literal !== undefined) {
                    variants.push({
                        caseName: sanitizeCaseName(literal),
                        literal,
                        payloadType: variantResult.expression,
                        nested: variantId === undefined,
                    });
                }
            }
            for (const variant of variants) {
                if (variant.nested) {
                    registry.markSealedVariantPayload(variant.payloadType);
                    registry.markSealedVariantPath(variant.payloadType, `${enumName}.${variant.caseName}`);
                    continue;
                }
                const payload = registry.get(variant.payloadType);
                if (payload?.kind === 'data-class') {
                    registry.replace({
                        ...payload,
                        sealedParent: enumName,
                        serialName: variant.literal,
                        discriminatorWireName: discriminated.discriminator,
                    });
                }
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
            const fields = objectFields(schema, registry, id);
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

    const { inner, optional } = unwrapOptionalWrappers(schema);
    if (optional) {
        const innerResult = mapType(inner, registry, hint);
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
            const outType = def.out ? readDefType(def.out) : undefined;
            if (def.out && outType !== 'transform') {
                return mapType(def.out, registry, hint);
            }
            if (def.in) return mapType(def.in, registry, hint);
            registry.warnJsonElement(hint, 'pipe schema missing resolvable type');
            return {
                expression: 'JsonElement',
                optional: false,
            };
        }
        case 'string': {
            const isDatetime = def.format === 'datetime' || def.checks?.some((check) => check.format === 'datetime');
            return {
                expression: isDatetime ? 'Instant' : 'String',
                optional: false,
            };
        }
        case 'number':
            return {
                expression: isIntegerSchema(schema) ? 'Int' : 'Double',
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
            const elementResult = mapType(element, registry, `${hint}Item`);
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
                const fields = objectFields(schema, registry, className);
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
                    unknownCase: registry.unknownEnumCase,
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
                const optionDef = readDef(option);
                return optionDef.type === 'literal' && (optionDef.values ?? []).every((value) => typeof value === 'string');
            });
            if (allStringLiterals) {
                return {
                    expression: 'String',
                    optional: false,
                };
            }
            const resolved = options
                .map((option) => mapType(option, registry, hint))
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

export const collectObjectFields = (schema: z.core.$ZodType, registry: TypeRegistry, hint: string): KotlinField[] => {
    return objectFields(schema, registry, hint);
};

export const objectFieldCount = (schema: z.core.$ZodType): number => {
    return Object.keys(readObjectShape(schema) ?? {}).length;
};

export const objectShapeKeys = (schema: z.core.$ZodType, camelCase = false): Array<{ name: string; wireName: string; isFile: boolean }> => {
    return Object.entries(readObjectShape(schema) ?? {}).map(([key, value]) => ({
        name: propertyName(key, camelCase),
        wireName: key,
        isFile: isFileSchema(value),
    }));
};
