import type { z } from 'zod';
import {
    isFileSchema,
    isBinarySchema,
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
    unknownCase: boolean;
}

export interface SwiftDiscriminatedEnum {
    kind: 'discriminated-enum';
    name: string;
    discriminator: string;
    variants: Array<{
        caseName: string;
        literal: string;
        payloadType: string;
        payloadRegistryName: string;
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
    private readonly unionVariantOwners = new Map<string, string>();
    public usesAnyCodable = false;

    constructor(
        public readonly camelCaseProperties = false,
        public readonly unknownEnumCase = false
    ) {}

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

    /**
     * Records that `payloadName` was synthesized as a variant of `unionName`. The real parent, as
     * opposed to the name-prefix guess the ownership heuristic would otherwise make.
     */
    markUnionVariant(payloadName: string, unionName: string): void {
        this.unionVariantOwners.set(payloadName, unionName);
    }

    unionVariantOwner(payloadName: string): string | undefined {
        return this.unionVariantOwners.get(payloadName);
    }

    warnAnyCodable(hint: string, reason: string): void {
        this.usesAnyCodable = true;
        this.warningSet.add(`${hint}: ${reason}`);
    }

    warnings(): string[] {
        return Array.from(this.warningSet);
    }
}

/**
 * The Swift property name for a wire key: verbatim, or camelCased under
 * `camelCaseProperties`.
 */
const propertyName = (key: string, camelCase: boolean): string => {
    if (!camelCase) return sanitizeFieldName(key);
    const camel = toCamelCase(key);
    if (!camel) return 'field';
    return /^[0-9]/.test(camel) ? `_${camel}` : camel;
};

const objectFields = (schema: z.core.$ZodType, registry: TypeRegistry, hint: string): SwiftField[] => {
    const shape = readObjectShape(schema) ?? {};
    const fields: SwiftField[] = [];
    const seen = new Map<string, string>();
    for (const [key, value] of Object.entries(shape)) {
        const childHint = `${hint}${toPascalCase(key)}`;
        const result = mapType(value, registry, childHint);
        const deprecation = readDeprecation(value);
        const swiftName = propertyName(key, registry.camelCaseProperties);
        const previousWireName = seen.get(swiftName);
        if (previousWireName !== undefined && previousWireName !== key) {
            throw new Error(
                `@ts-kizuna/swift: field key collision in ${hint}, ${stringify(previousWireName)} and ${stringify(key)} both sanitize to ${stringify(swiftName)}.`
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

    if (isBinarySchema(schema)) {
        return {
            expression: 'Foundation.Data',
            optional: false,
        };
    }

    const id = readMetaId(schema);
    const def = readDef(schema);

    // Discriminated union
    const discriminated = readDiscriminatedUnion(schema);
    if (discriminated) {
        const enumName = id ?? sanitizeIdentifier(toPascalCase(hint));
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
                const literal = readDiscriminatorStringLiteral(option, discriminated.discriminator);
                const variantHint = variantId ?? `${enumName}${toPascalCase(literal ?? 'Variant')}`;
                const variantResult = mapType(option, registry, variantHint);
                if (literal !== undefined) {
                    variants.push({
                        caseName: sanitizeCaseName(literal),
                        literal,
                        payloadType: variantResult.expression,
                        payloadRegistryName: variantResult.expression,
                    });
                    if (variantId === undefined) {
                        registry.markUnionVariant(variantResult.expression, enumName);
                    }
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
            const fields = objectFields(schema, registry, id);
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
                expression: 'Void',
                optional: false,
            };
        case 'pipe': {
            const outType = def.out ? readDefType(def.out) : undefined;
            if (def.out && outType !== 'transform') {
                return mapType(def.out, registry, hint);
            }
            if (def.in) return mapType(def.in, registry, hint);
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
                expression: isIntegerSchema(schema) ? 'Int' : 'Double',
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
            const elementResult = mapType(element, registry, `${hint}Item`);
            return {
                expression: `[${elementResult.expression.replace(/\?$/, '')}]`,
                optional: false,
            };
        }
        case 'object': {
            const structName = sanitizeIdentifier(toPascalCase(hint));
            if (!registry.has(structName)) {
                registry.add({
                    kind: 'struct',
                    name: structName,
                    fields: [],
                    description: readMetaDescription(schema),
                });
                const fields = objectFields(schema, registry, structName);
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
            const enumName = sanitizeIdentifier(toPascalCase(hint));
            const entries = def.entries ?? {};
            const cases = Object.values(entries);
            if (!registry.has(enumName)) {
                registry.add({
                    kind: 'enum',
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

export const collectObjectFields = (schema: z.core.$ZodType, registry: TypeRegistry, hint: string): SwiftField[] => {
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
