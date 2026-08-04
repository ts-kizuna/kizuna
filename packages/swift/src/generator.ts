import type { z } from 'zod';
import {
    loadDeprecations,
    contractFingerprint,
    createGenerator,
    isVoidSchema,
    isObjectSchema,
    isDiscriminatedUnionSchema,
    parsePath,
    resolveResponseBody,
    resolveResponseHeaders,
    resolveResponseContentType,
    isJsonMediaType,
    isBinarySchema,
    readMetaId,
    toPascalCase,
    toCamelCase,
    shortTypeName,
    isHintPrefix,
    localTypeName,
    statusToCamelCase,
    isSuccessStatus,
    mergeHeaderFields,
    type Routes,
    type RouteDefinition,
} from '@ts-kizuna/core/generator';
import type { Contract } from '@ts-kizuna/core';
import { SwiftWriter, stringLiteral } from './emit.js';
import {
    TypeRegistry,
    mapType,
    collectObjectFields,
    objectFieldCount,
    objectShapeKeys,
    type SwiftField,
    type SwiftType,
} from './zod-to-swift.js';

export interface SwiftConfig {
    namespaceName: string;
    /**
     * Convert wire field names to camelCase properties, mapping the wire name
     * back via `CodingKeys`. When off, names are kept verbatim so the generated
     * types mirror the wire shape.
     *
     * @default false
     */
    camelCaseProperties?: boolean;
    /**
     * Emit each `z.enum` as a `RawRepresentable` enum with a `case unknown(String)`
     * fallback, so unrecognised wire values decode instead of throwing. The raw
     * string round-trips on encode and in query params. Discriminated unions are
     * unaffected and still throw on an unknown discriminator.
     *
     * @default false
     */
    unknownEnumCase?: boolean;
}

interface BodyDescriptor {
    kind: 'json-flat' | 'json-struct' | 'multipart' | 'union' | 'json-empty';
    structName?: string;
    flattened: SwiftField[];
    multipartFields: Array<{ name: string; wireName: string; isFile: boolean }>;
}

interface RouteMethod {
    name: string;
    operationName: string;
    summary?: string;
    description?: string;
    deprecated: boolean;
    deprecationMessage?: string;
    pathParams: string[];
    declaredPathParams: SwiftField[];
    pathTemplate: string;
    method: string;
    body?: BodyDescriptor;
    query: SwiftField[];
    headers: SwiftField[];
    resultHeaderFields: SwiftField[];
    resultWrapperName?: string;
    successResponses: Array<{
        status: number;
        type: string;
        responseHeaders: SwiftField[];
        isRaw: boolean;
        isBinary: boolean;
    }>;
    successReturnType: string;
    successSumEnumName?: string;
    failureEnumName: string;
    errorCases: Array<{
        caseName: string;
        status: number;
        type: string;
        isRaw: boolean;
        isBinary: boolean;
    }>;
}

interface RouteGroup {
    groupKey: string;
    structName: string;
    propertyName: string;
    methods: RouteMethod[];
}

interface RoutesPartition {
    flatMethods: RouteMethod[];
    groups: RouteGroup[];
}

interface EmitContext {
    namespaceName: string;
    clientName: string;
    operationTypeMap: Map<string, string>;
    fileLevelTypeNames: Set<string>;
    // Types owned by a struct (by name-prefix convention) — nested inside that struct.
    // resolveType returns API.OwningStruct.ShortName for these.
    ownedTypeMap: Map<string, string>; // typeName → owningStructName
    // Lets the tuple-based call surface recurse into nested object / union payload fields.
    registry: TypeRegistry;
    // Header fields from the contract's request context declarations; empty when none.
    requestContextFields: SwiftField[];
}

const buildRouteMethod = (
    routeKey: string,
    route: RouteDefinition,
    registry: TypeRegistry,
    deprecated: boolean,
    deprecationMessage: string | undefined,
    fieldPaths: Map<string, string> | undefined,
    deprecationSchemas: Map<string, Map<string, string>> | undefined,
    methodNameOverride?: string
): RouteMethod => {
    const fullJoinedName = routeKey.includes('.')
        ? routeKey
              .split('.')
              .map((segment, index) => (index === 0 ? segment : toPascalCase(segment)))
              .join('')
        : routeKey;
    const methodName = methodNameOverride ?? fullJoinedName;
    const baseHint = toPascalCase(fullJoinedName);
    const pathParams = parsePath(route.path).paramNames;

    const declaredPathParams: SwiftField[] = route.pathParams
        ? collectObjectFields(route.pathParams as z.ZodType, registry, `${baseHint}Params`, fieldPaths, 'pathParams', deprecationSchemas)
        : [];

    const queryFields: SwiftField[] = route.query
        ? collectObjectFields(route.query as z.ZodType, registry, `${baseHint}Query`, fieldPaths, 'query', deprecationSchemas)
        : [];

    const headerFields: SwiftField[] = route.headers
        ? collectObjectFields(route.headers as z.ZodType, registry, `${baseHint}Headers`, fieldPaths, 'headers', deprecationSchemas)
        : [];

    let bodyDescriptor: BodyDescriptor | undefined;
    if (route.body && !isVoidSchema(route.body)) {
        const bodyHint = readMetaId(route.body as never) ?? `${baseHint}Input`;
        const isMultipart = route.contentType === 'multipart/form-data';
        const isUnion = isDiscriminatedUnionSchema(route.body as z.ZodType);

        if (isUnion) {
            const result = mapType(route.body as z.ZodType, registry, bodyHint, fieldPaths, 'body', deprecationSchemas);
            bodyDescriptor = {
                kind: 'union',
                structName: result.expression,
                flattened: [],
                multipartFields: [],
            };
        } else if (isMultipart) {
            // Always emit the struct for type clarity, but call sites use flat params (file fields → MultipartFile)
            mapType(route.body as z.ZodType, registry, bodyHint, fieldPaths, 'body', deprecationSchemas);
            const flattened = collectObjectFields(route.body as z.ZodType, registry, bodyHint, fieldPaths, 'body', deprecationSchemas);
            const multipartFields = objectShapeKeys(route.body as z.ZodType, registry.camelCaseProperties);
            bodyDescriptor = {
                kind: 'multipart',
                flattened,
                multipartFields,
            };
        } else {
            const isObject = isObjectSchema(route.body as z.ZodType);
            const fieldCount = isObject ? objectFieldCount(route.body as z.ZodType) : 0;

            if (isObject && fieldCount === 0) {
                bodyDescriptor = {
                    kind: 'json-empty',
                    flattened: [],
                    multipartFields: [],
                };
            } else {
                const result = mapType(route.body as z.ZodType, registry, bodyHint, fieldPaths, 'body', deprecationSchemas);
                const structName = result.expression;

                if (!isObject) {
                    // Non-object JSON body (top-level array, primitive, record): passed as a single
                    // typed `body:` value.
                    bodyDescriptor = {
                        kind: 'json-struct',
                        structName,
                        flattened: [],
                        multipartFields: [],
                    };
                } else {
                    // Object body of any field count: exposed as a labeled tuple, rebuilt into the
                    // Codable Input internally. Tuples handle any arity, so there is no flatten cap.
                    const flattened = collectObjectFields(
                        route.body as z.ZodType,
                        registry,
                        bodyHint,
                        fieldPaths,
                        'body',
                        deprecationSchemas
                    );
                    bodyDescriptor = {
                        kind: 'json-flat',
                        structName,
                        flattened,
                        multipartFields: [],
                    };
                }
            }
        }
    }

    const successResponses: RouteMethod['successResponses'] = [];
    const errorCases: RouteMethod['errorCases'] = [];

    for (const [statusKey, responseValue] of Object.entries(route.responses)) {
        const status = Number(statusKey);
        const responseHint = `${baseHint}Response${status === 200 ? '' : status}`;
        const bodySchema = resolveResponseBody(responseValue);
        const responseContentType = resolveResponseContentType(responseValue);
        const isBinary = isBinarySchema(bodySchema as z.core.$ZodType);
        const isRaw = isBinary || (responseContentType !== undefined && !isJsonMediaType(responseContentType));
        const result = mapType(bodySchema as z.ZodType, registry, responseHint, fieldPaths, `responses.${statusKey}`, deprecationSchemas);
        const typeExpression = result.expression;
        if (isSuccessStatus(status)) {
            const headersSchema = resolveResponseHeaders(responseValue);
            const perStatusHeaderFields: SwiftField[] = headersSchema
                ? collectObjectFields(
                      headersSchema as z.ZodType,
                      registry,
                      `${baseHint}ResponseHeaders`,
                      fieldPaths,
                      'responseHeaders',
                      deprecationSchemas
                  )
                : [];
            successResponses.push({
                status,
                type: typeExpression,
                responseHeaders: perStatusHeaderFields,
                isRaw,
                isBinary,
            });
        } else {
            errorCases.push({
                caseName: statusToCamelCase(status),
                status,
                type: typeExpression,
                isRaw,
                isBinary,
            });
        }
    }
    const hasValidation = route.body || route.query;
    if (hasValidation) {
        const has400 = errorCases.some((c) => c.status === 400);
        errorCases.push({
            caseName: has400 ? 'validationError' : statusToCamelCase(400),
            status: 400,
            type: 'ValidationError',
            isRaw: false,
            isBinary: false,
        });
    }

    successResponses.sort((left, right) => left.status - right.status);

    const resultHeaderFields: SwiftField[] = mergeHeaderFields(successResponses.map((entry) => entry.responseHeaders));

    let successReturnType = 'Void';
    let successSumEnumName: string | undefined;
    if (route.method !== 'HEAD') {
        const onlySuccess = successResponses[0];
        if (successResponses.length === 1 && onlySuccess) {
            successReturnType = onlySuccess.type;
        } else if (successResponses.length > 1) {
            successSumEnumName = 'Success';
            successReturnType = successSumEnumName;
        }
    }

    const resultWrapperName = successReturnType !== 'Void' ? 'Result' : undefined;

    return {
        name: methodName,
        operationName: baseHint,
        summary: route.summary,
        description: route.description,
        deprecated,
        deprecationMessage,
        pathParams,
        declaredPathParams,
        pathTemplate: route.path,
        method: route.method,
        body: bodyDescriptor,
        query: queryFields,
        headers: headerFields,
        resultHeaderFields,
        resultWrapperName,
        successResponses,
        successReturnType,
        successSumEnumName,
        failureEnumName: 'Failure',
        errorCases,
    };
};

const swiftGenerator = createGenerator((options: SwiftConfig & { registry: TypeRegistry }, contract: Contract) => {
    const flatMethods: RouteMethod[] = [];
    const groupMap = new Map<string, RouteMethod[]>();
    const deprecationSchemas = loadDeprecations(contractFingerprint(contract))?.schemas;

    return {
        processRoute({ routeKey, route, deprecated, deprecationMessage, fieldDeprecations }) {
            const dotIndex = routeKey.indexOf('.');
            if (dotIndex !== -1) {
                const groupKey = routeKey.slice(0, dotIndex);
                const remainder = routeKey.slice(dotIndex + 1);
                const leafName = remainder
                    .split('.')
                    .map((segment: string, index: number) => (index === 0 ? segment : toPascalCase(segment)))
                    .join('');
                const methods = groupMap.get(groupKey) ?? [];
                if (methods.length === 0) groupMap.set(groupKey, methods);
                methods.push(
                    buildRouteMethod(
                        routeKey,
                        route,
                        options.registry,
                        deprecated,
                        deprecationMessage,
                        fieldDeprecations,
                        deprecationSchemas,
                        leafName
                    )
                );
            } else {
                flatMethods.push(
                    buildRouteMethod(
                        routeKey,
                        route,
                        options.registry,
                        deprecated,
                        deprecationMessage,
                        fieldDeprecations,
                        deprecationSchemas
                    )
                );
            }
        },

        finalize(): RoutesPartition {
            const groups: RouteGroup[] = [];
            for (const [groupKey, methods] of groupMap) {
                groups.push({
                    groupKey,
                    structName: `${options.namespaceName}${toPascalCase(groupKey)}Client`,
                    propertyName: groupKey,
                    methods,
                });
            }
            return { flatMethods, groups };
        },
    };
});

const SWIFT_KEYWORDS = new Set([
    'associatedtype',
    'class',
    'deinit',
    'enum',
    'extension',
    'fileprivate',
    'func',
    'import',
    'init',
    'inout',
    'internal',
    'let',
    'open',
    'operator',
    'private',
    'protocol',
    'public',
    'rethrows',
    'static',
    'struct',
    'subscript',
    'typealias',
    'var',
    'break',
    'case',
    'continue',
    'default',
    'defer',
    'do',
    'else',
    'fallthrough',
    'for',
    'guard',
    'if',
    'in',
    'repeat',
    'return',
    'switch',
    'where',
    'while',
    'as',
    'catch',
    'false',
    'is',
    'nil',
    'super',
    'self',
    'Self',
    'throw',
    'throws',
    'true',
    'try',
    'Type',
    'Protocol',
    'description',
]);

const escapeKeyword = (name: string): string => {
    return SWIFT_KEYWORDS.has(name) ? `\`${name}\`` : name;
};

const isValidSwiftIdentifier = (value: string): boolean => {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
};

/**
 * Rewrite an enum value into a valid Swift case name, preserving the original
 * as the rawValue. Already-valid identifiers (e.g. `snake_case`) are kept
 * verbatim; others are camelCased, with a `_` prefix when they start with a
 * digit. Falls back to `_` when nothing identifier-safe remains.
 */
const sanitizeEnumCaseName = (value: string): string => {
    if (isValidSwiftIdentifier(value)) return value;
    const camel = toCamelCase(value);
    if (!camel) return '_';
    return /^[0-9]/.test(camel) ? `_${camel}` : camel;
};

const optionalize = (type: string, optional: boolean): string => {
    if (!optional) return type;
    return type.endsWith('?') ? type : `${type}?`;
};

// Emits the group-named factory (`.params(...)`, `.query(...)`) mirroring the memberwise init; optional
// fields default to `nil`. `fields` carry resolved Swift types; `buildExpression` produces the returned
// value (default `.init(args)`).
const emitNamedFactory = (
    writer: SwiftWriter,
    factoryName: string,
    fields: SwiftField[],
    buildExpression?: (args: string) => string
): void => {
    const build = buildExpression ?? ((args: string) => `.init(${args})`);
    if (fields.length === 0) {
        writer.block(`public static func ${escapeKeyword(factoryName)}() -> Self`, () => {
            writer.line(build(''));
        });
        return;
    }
    const params = fields.map((field) => {
        const typeExpression = optionalize(field.type, field.optional);
        const defaultPart = field.optional ? ' = nil' : '';
        return `${escapeKeyword(field.name)}: ${typeExpression}${defaultPart}`;
    });
    const args = fields.map((field) => `${field.name}: ${escapeKeyword(field.name)}`).join(', ');
    if (params.length === 1) {
        writer.block(`public static func ${escapeKeyword(factoryName)}(${params[0]}) -> Self`, () => {
            writer.line(build(args));
        });
        return;
    }
    writer.line(`public static func ${escapeKeyword(factoryName)}(`);
    for (let index = 0; index < params.length; index += 1) {
        writer.line(`    ${params[index]}${index === params.length - 1 ? '' : ','}`);
    }
    writer.block(') -> Self', () => {
        writer.line(build(args));
    });
};

const emitMemberwiseInit = (
    writer: SwiftWriter,
    fields: SwiftField[],
    assignmentTarget: (field: SwiftField) => string = (field) => escapeKeyword(field.name)
): void => {
    if (fields.length === 0) {
        writer.line('public init() {}');
        return;
    }
    const params = fields.map((field) => {
        const typeExpression = optionalize(field.type, field.optional);
        const defaultPart = field.optional ? ' = nil' : '';
        return `${escapeKeyword(field.name)}: ${typeExpression}${defaultPart}`;
    });
    if (params.length === 1) {
        writer.block(`public init(${params[0]})`, () => {
            for (const field of fields) {
                writer.line(`self.${assignmentTarget(field)} = ${escapeKeyword(field.name)}`);
            }
        });
        return;
    }
    writer.line('public init(');
    for (let index = 0; index < params.length; index += 1) {
        const suffix = index === params.length - 1 ? '' : ',';
        writer.line(`    ${params[index]}${suffix}`);
    }
    writer.block(')', () => {
        for (const field of fields) {
            writer.line(`self.${assignmentTarget(field)} = ${escapeKeyword(field.name)}`);
        }
    });
};

// Swift has no way to suppress deprecation warnings, so deprecated fields are emitted as
// computed properties over private storage. Generated code only touches the storage.
const deprecatedStorageName = (field: SwiftField, siblings: SwiftField[]): string => {
    const takenNames = new Set(siblings.map((sibling) => sibling.name));
    let storageName = `_${field.name}`;
    while (takenNames.has(storageName)) {
        storageName = `_${storageName}`;
    }
    return storageName;
};

// `unknown`, or `_unknown` etc. when a wire value already claims that name.
const unknownCaseName = (caseNames: string[]): string => {
    const taken = new Set(caseNames);
    let candidate = 'unknown';
    while (taken.has(candidate)) {
        candidate = `_${candidate}`;
    }
    return candidate;
};

const emitStringEnum = (writer: SwiftWriter, name: string, cases: string[], unknownCase: boolean, description?: string): void => {
    writer.blank();
    writer.docComment(description);
    if (!unknownCase) {
        writer.block(`public enum ${name}: String, Codable, Sendable`, () => {
            for (const caseName of cases) {
                writer.line(`case ${escapeKeyword(sanitizeEnumCaseName(caseName))} = ${stringLiteral(caseName)}`);
            }
        });
        return;
    }
    const caseNames = cases.map((caseName) => sanitizeEnumCaseName(caseName));
    const unknown = unknownCaseName(caseNames);
    writer.block(`public enum ${name}: RawRepresentable, Codable, Sendable, Hashable`, () => {
        for (const caseName of caseNames) {
            writer.line(`case ${escapeKeyword(caseName)}`);
        }
        writer.line(`case ${escapeKeyword(unknown)}(String)`);
        writer.blank();
        writer.block('public init(rawValue: String)', () => {
            writer.line('switch rawValue {');
            for (let index = 0; index < cases.length; index += 1) {
                writer.line(`case ${stringLiteral(cases[index]!)}: self = .${escapeKeyword(caseNames[index]!)}`);
            }
            writer.line(`default: self = .${escapeKeyword(unknown)}(rawValue)`);
            writer.line('}');
        });
        writer.blank();
        writer.block('public var rawValue: String', () => {
            writer.line('switch self {');
            for (let index = 0; index < cases.length; index += 1) {
                writer.line(`case .${escapeKeyword(caseNames[index]!)}: return ${stringLiteral(cases[index]!)}`);
            }
            writer.line(`case let .${escapeKeyword(unknown)}(value): return value`);
            writer.line('}');
        });
        writer.blank();
        writer.block('public init(from decoder: Decoder) throws', () => {
            writer.line('let container = try decoder.singleValueContainer()');
            writer.line('self.init(rawValue: try container.decode(String.self))');
        });
        writer.blank();
        writer.block('public func encode(to encoder: Encoder) throws', () => {
            writer.line('var container = encoder.singleValueContainer()');
            writer.line('try container.encode(rawValue)');
        });
    });
};

const ownedTypePath = (typeName: string, ownedTypeMap: Map<string, string>): string => {
    const owningStruct = ownedTypeMap.get(typeName);
    if (owningStruct === undefined) return typeName;
    return `${ownedTypePath(owningStruct, ownedTypeMap)}.${shortTypeName(typeName, owningStruct)}`;
};

const qualifyOwnedVariants = (
    type: Extract<SwiftType, { kind: 'discriminated-enum' }>,
    ownedTypeMap: Map<string, string>
): Extract<SwiftType, { kind: 'discriminated-enum' }> => ({
    ...type,
    variants: type.variants.map((variant) => ({
        ...variant,
        payloadType: ownedTypePath(variant.payloadType, ownedTypeMap),
    })),
});

const emitTypes = (
    writer: SwiftWriter,
    types: SwiftType[],
    context: EmitContext,
    ownedTypeMap: Map<string, string> = new Map(),
    ownedTypeLookup: Map<string, SwiftType> = new Map()
): void => {
    for (const type of types) {
        writer.blank();
        writer.docComment(type.description);
        if (type.kind === 'struct') {
            emitStruct(writer, type, context, ownedTypeMap, ownedTypeLookup);
        } else if (type.kind === 'enum') {
            emitStringEnum(writer, type.name, type.cases, type.unknownCase, type.description);
        } else {
            emitDiscriminatedEnum(writer, qualifyOwnedVariants(type, ownedTypeMap), context);
        }
    }
};

const emitStruct = (
    writer: SwiftWriter,
    type: Extract<SwiftType, { kind: 'struct' }>,
    context: EmitContext,
    ownedTypeMap: Map<string, string>,
    ownedTypeLookup: Map<string, SwiftType>,
    registryName?: string
): void => {
    const lookupName = registryName ?? type.name;
    const hasFile = type.fields.some((field) => field.isFile);
    const conformances = hasFile ? 'Sendable, Equatable' : 'Codable, Sendable, Equatable';

    const resolveOwnedType = (raw: string): string => {
        const optional = raw.endsWith('?');
        const stripped = optional ? raw.slice(0, -1) : raw;
        const isArray = stripped.startsWith('[') && stripped.endsWith(']');
        const inner = isArray ? stripped.slice(1, -1) : stripped;
        if (ownedTypeMap.get(inner) !== lookupName) return raw;
        const short = shortTypeName(inner, lookupName);
        const resolved = isArray ? `[${short}]` : short;
        return optional ? `${resolved}?` : resolved;
    };

    const resolveFieldType = (fieldType: string, fieldOptional: boolean): string => {
        return optionalize(resolveOwnedType(fieldType), fieldOptional);
    };

    const adjustedFields = type.fields.map((field) => ({
        ...field,
        type: resolveOwnedType(field.type),
    }));

    const needsCodingKeys =
        !hasFile &&
        type.fields.some((field) => field.name !== field.wireName || SWIFT_KEYWORDS.has(field.name) || field.deprecated === true);
    writer.block(`public struct ${type.name}: ${conformances}`, () => {
        for (const [ownedName, owningStruct] of ownedTypeMap) {
            if (owningStruct !== lookupName) continue;
            const ownedType = ownedTypeLookup.get(ownedName);
            if (!ownedType) continue;
            const shortName = shortTypeName(ownedName, lookupName);
            if (ownedType.kind === 'enum') {
                emitStringEnum(writer, shortName, ownedType.cases, ownedType.unknownCase, ownedType.description);
            } else if (ownedType.kind === 'struct') {
                emitStruct(writer, { ...ownedType, name: shortName }, context, ownedTypeMap, ownedTypeLookup, ownedName);
            } else if (ownedType.kind === 'discriminated-enum') {
                emitDiscriminatedEnum(writer, qualifyOwnedVariants({ ...ownedType, name: shortName }, ownedTypeMap), context);
            }
        }
        for (const field of type.fields) {
            const fieldType = resolveFieldType(field.type, field.optional);
            if (field.deprecated) {
                writer.line(`private let ${deprecatedStorageName(field, type.fields)}: ${fieldType}`);
                writer.docComment(field.description);
                writer.line(deprecatedAttribute(field.deprecationMessage));
                writer.line(`public var ${escapeKeyword(field.name)}: ${fieldType} { ${deprecatedStorageName(field, type.fields)} }`);
            } else {
                writer.docComment(field.description);
                writer.line(`public let ${escapeKeyword(field.name)}: ${fieldType}`);
            }
        }
        if (needsCodingKeys) {
            writer.blank();
            writer.block('private enum CodingKeys: String, CodingKey', () => {
                for (const field of type.fields) {
                    if (field.deprecated) {
                        writer.line(`case ${deprecatedStorageName(field, type.fields)} = ${stringLiteral(field.wireName)}`);
                    } else if (field.name === field.wireName) {
                        writer.line(`case ${escapeKeyword(field.name)}`);
                    } else {
                        writer.line(`case ${escapeKeyword(field.name)} = ${stringLiteral(field.wireName)}`);
                    }
                }
            });
        }
        writer.blank();
        emitMemberwiseInit(writer, adjustedFields, (field) =>
            field.deprecated ? deprecatedStorageName(field, type.fields) : escapeKeyword(field.name)
        );
    });
};

const emitDiscriminatedEnum = (
    writer: SwiftWriter,
    type: Extract<SwiftType, { kind: 'discriminated-enum' }>,
    context: EmitContext
): void => {
    writer.block(`public enum ${type.name}: Codable, Sendable, Equatable`, () => {
        for (const variant of type.variants) {
            writer.line(`case ${escapeKeyword(variant.caseName)}(${variant.payloadType})`);
        }

        // Static factory per variant (`.email(to:subject:)`); the payload struct is built here with the
        // discriminator literal injected.
        for (const variant of type.variants) {
            const payloadStruct = registryStruct(variant.payloadRegistryName, context);
            if (!payloadStruct) continue;
            const isDiscriminator = (field: SwiftField): boolean =>
                field.wireName === type.discriminator || field.name === type.discriminator;
            const valueFields = payloadStruct.fields.filter((field) => !isDiscriminator(field));
            const factoryParams = valueFields
                .map((field) => {
                    const defaultPart = field.optional ? ' = nil' : '';
                    return `${escapeKeyword(field.name)}: ${optionalize(resolveType(field.type, undefined, context), field.optional)}${defaultPart}`;
                })
                .join(', ');
            const payloadArgs = payloadStruct.fields
                .map((field) => {
                    if (isDiscriminator(field)) {
                        const literal = field.type === 'String' ? stringLiteral(variant.literal) : variant.literal;
                        return `${field.name}: ${literal}`;
                    }
                    return `${field.name}: ${escapeKeyword(field.name)}`;
                })
                .join(', ');
            writer.block(`public static func ${escapeKeyword(variant.caseName)}(${factoryParams}) -> ${type.name}`, () => {
                writer.line(`.${escapeKeyword(variant.caseName)}(${variant.payloadType}(${payloadArgs}))`);
            });
        }
        writer.blank();
        writer.block('private enum DiscriminatorKey: String, CodingKey', () => {
            writer.line(`case discriminator = ${stringLiteral(type.discriminator)}`);
        });
        writer.blank();
        writer.block('public init(from decoder: Decoder) throws', () => {
            writer.line('let container = try decoder.container(keyedBy: DiscriminatorKey.self)');
            writer.line('let kind = try container.decode(String.self, forKey: .discriminator)');
            writer.line('let single = try decoder.singleValueContainer()');
            writer.line('switch kind {');
            for (const variant of type.variants) {
                writer.line(`case ${stringLiteral(variant.literal)}:`);
                writer.line(`    self = .${escapeKeyword(variant.caseName)}(try single.decode(${variant.payloadType}.self))`);
            }
            writer.line('default:');
            writer.line(
                '    throw DecodingError.dataCorruptedError(forKey: .discriminator, in: container, debugDescription: "Unknown discriminator: \\(kind)")'
            );
            writer.line('}');
        });
        writer.blank();
        writer.block('public func encode(to encoder: Encoder) throws', () => {
            writer.line('var single = encoder.singleValueContainer()');
            writer.line('switch self {');
            for (const variant of type.variants) {
                writer.line(`case .${escapeKeyword(variant.caseName)}(let payload):`);
                writer.line('    try single.encode(payload)');
            }
            writer.line('}');
        });
    });
};

const buildOperationTypeMap = (allMethods: RouteMethod[], registry: TypeRegistry): Map<string, string> => {
    const operationNames = new Set(allMethods.map((method) => method.operationName));
    const operationTypeMap = new Map<string, string>();
    for (const type of registry.all()) {
        let bestMatch: string | undefined;
        for (const operationName of operationNames) {
            if (isHintPrefix(type.name, operationName)) {
                if (!bestMatch || operationName.length > bestMatch.length) {
                    bestMatch = operationName;
                }
            }
        }
        if (bestMatch !== undefined) {
            operationTypeMap.set(type.name, bestMatch);
        }
    }
    return operationTypeMap;
};

const SWIFT_PRIMITIVE_TYPES = new Set(['String', 'Int', 'Double', 'Bool', 'Date', 'Void', 'Foundation.Data']);

// Resolve a registry type name to the Swift reference expression appropriate for the given context.
// scope 'operation-enum': inside the operation's nested enum — same-op types use unqualified short name.
// scope 'actor': anywhere else — operation types are fully qualified (works inside actor AND sub-client structs).
const resolveType = (
    typeName: string,
    currentOperation: string | undefined,
    context: EmitContext,
    scope: 'operation-enum' | 'actor' = 'actor'
): string => {
    const { operationTypeMap, namespaceName, clientName, fileLevelTypeNames } = context;
    const optional = typeName.endsWith('?');
    const base = optional ? typeName.slice(0, -1) : typeName;

    if (SWIFT_PRIMITIVE_TYPES.has(base)) return typeName;

    if (base.startsWith('[') && base.endsWith(']')) {
        const inner = base.slice(1, -1);
        const resolved = resolveType(inner, currentOperation, context, scope);
        return optional ? `[${resolved}]?` : `[${resolved}]`;
    }

    if (base === 'MultipartFile' || base === 'ValidationError' || base === 'ValidationIssue') {
        const qualified = `${clientName}.${base}`;
        return optional ? `${qualified}?` : qualified;
    }

    if (base === 'AnyCodable') {
        const qualified = `${clientName}.JSONValue`;
        return optional ? `${qualified}?` : qualified;
    }

    if (fileLevelTypeNames.has(base)) {
        return optional ? `${base}?` : base;
    }

    const owningStruct = context.ownedTypeMap.get(base);
    if (owningStruct !== undefined) {
        const short = shortTypeName(base, owningStruct);
        const ownerResolved = resolveType(owningStruct, currentOperation, context, scope).replace(/\?$/, '');
        return optional ? `${ownerResolved}.${short}?` : `${ownerResolved}.${short}`;
    }

    const owningOp = operationTypeMap.get(base);
    if (owningOp === undefined) {
        return optional ? `${namespaceName}.${base}?` : `${namespaceName}.${base}`;
    }
    const short = localTypeName(base, owningOp);
    if (owningOp === currentOperation && scope === 'operation-enum') {
        return optional ? `${short}?` : short;
    }
    // Fully qualify so the reference works inside actor and sub-client Sendable structs.
    return optional ? `${clientName}.${owningOp}.${short}?` : `${clientName}.${owningOp}.${short}`;
};

const localizeType = (type: SwiftType, operationName: string, context: EmitContext): SwiftType => {
    const shortName = localTypeName(type.name, operationName);
    if (type.kind === 'struct') {
        return {
            ...type,
            name: shortName,
            fields: type.fields.map((field) => ({
                ...field,
                type: resolveType(field.type, operationName, context, 'operation-enum'),
            })),
        };
    }
    if (type.kind === 'enum') {
        return { ...type, name: shortName };
    }
    return {
        ...type,
        name: shortName,
        variants: type.variants.map((variant) => ({
            ...variant,
            payloadType: resolveType(variant.payloadType, operationName, context, 'operation-enum'),
        })),
    };
};

const emitResultStruct = (writer: SwiftWriter, method: RouteMethod, context: EmitContext): void => {
    if (!method.resultWrapperName) return;
    writer.blank();
    writer.block('public struct Result: Sendable', () => {
        const bodyType = method.successSumEnumName
            ? 'Success'
            : resolveType(method.successReturnType, method.operationName, context, 'operation-enum');
        const hasHeaders = method.resultHeaderFields.length > 0;
        writer.line(`public let body: ${bodyType}`);
        if (hasHeaders) {
            writer.line('public let headers: Headers');
            writer.blank();
            writer.block('public struct Headers: Sendable', () => {
                for (const field of method.resultHeaderFields) {
                    const rawType = resolveType(field.type, method.operationName, context, 'operation-enum');
                    writer.line(`public let ${escapeKeyword(field.name)}: ${optionalize(rawType, field.optional)}`);
                }
            });
        }
        writer.blank();
        if (hasHeaders) {
            writer.block(`public init(body: ${bodyType}, headers: Headers)`, () => {
                writer.line('self.body = body');
                writer.line('self.headers = headers');
            });
        } else {
            writer.block(`public init(body: ${bodyType})`, () => {
                writer.line('self.body = body');
            });
        }
    });
};

// Emits a request-group struct (params / query / headers) with its fields, memberwise init, and group-named factory.
const emitGroupStruct = (
    writer: SwiftWriter,
    structName: string,
    factoryName: string,
    fields: SwiftField[],
    method: RouteMethod,
    context: EmitContext
): void => {
    const resolved = fields.map((field) => ({
        ...field,
        type: resolveType(field.type, method.operationName, context, 'operation-enum'),
    }));
    writer.blank();
    writer.block(`public struct ${structName}: Sendable`, () => {
        for (const field of resolved) {
            writer.line(`public let ${escapeKeyword(field.name)}: ${optionalize(field.type, field.optional)}`);
        }
        writer.blank();
        emitMemberwiseInit(writer, resolved);
        writer.blank();
        emitNamedFactory(writer, factoryName, resolved);
    });
};

// Emits the `Body` group struct and `.body(...)` factory. Object bodies take the fields (building the
// Codable payload); union / non-object bodies take the value directly; multipart takes its fields.
const emitBodyType = (writer: SwiftWriter, method: RouteMethod, context: EmitContext): void => {
    const body = method.body;
    if (!body || body.kind === 'json-empty') return;
    const operationName = method.operationName;
    writer.blank();

    if (body.kind === 'multipart') {
        const resolved = body.flattened.map((field) => ({
            ...field,
            type: resolveType(field.type, operationName, context, 'operation-enum'),
        }));
        writer.block('public struct Body: Sendable', () => {
            for (const field of resolved) {
                writer.line(`public let ${escapeKeyword(field.name)}: ${optionalize(field.type, field.optional)}`);
            }
            writer.blank();
            emitMemberwiseInit(writer, resolved);
            writer.blank();
            emitNamedFactory(writer, 'body', resolved);
        });
        return;
    }

    const payloadType = body.structName
        ? resolveType(body.structName, operationName, context, 'operation-enum')
        : `${context.clientName}.JSONValue`;
    writer.block('public struct Body: Sendable', () => {
        writer.line(`public let payload: ${payloadType}`);
        writer.blank();
        writer.block(`public init(payload: ${payloadType})`, () => {
            writer.line('self.payload = payload');
        });
        writer.blank();
        if (body.kind === 'json-flat') {
            const resolved = body.flattened.map((field) => ({
                ...field,
                type: resolveType(field.type, operationName, context, 'operation-enum'),
            }));
            emitNamedFactory(writer, 'body', resolved, (args) => `.init(payload: ${payloadType}(${args}))`);
        } else {
            // union / non-object / AnyCodable body — the value is passed straight through, unlabeled.
            writer.block(`public static func body(_ value: ${payloadType}) -> Self`, () => {
                writer.line('.init(payload: value)');
            });
        }
    });
};

const emitRequestGroupStructs = (writer: SwiftWriter, method: RouteMethod, context: EmitContext): void => {
    if (method.pathParams.length > 0) emitGroupStruct(writer, 'Params', 'params', pathParamFields(method), method, context);
    if (method.query.length > 0) emitGroupStruct(writer, 'Query', 'query', method.query, method, context);
    if (method.headers.length > 0) emitGroupStruct(writer, 'Headers', 'headers', method.headers, method, context);
    emitBodyType(writer, method, context);
};

const emitFailureEnum = (writer: SwiftWriter, method: RouteMethod, context: EmitContext): void => {
    writer.blank();
    const hasDecodedResponse = method.successReturnType !== 'Void' || method.errorCases.some((c) => c.type !== 'Void');
    const failureProtocol = hasDecodedResponse ? 'KizunaDecodableFailure' : 'KizunaFailure';
    writer.block(`public enum Failure: Swift.Error, Sendable, ${failureProtocol}`, () => {
        writer.line('case requestFailed(Swift.Error)');
        writer.line('case invalidRequest');
        writer.line('case cancelled');
        writer.line('case invalidResponse');
        if (hasDecodedResponse) {
            writer.line('case decoding(Swift.Error, statusCode: Int, data: Foundation.Data)');
        }
        writer.line('case unexpectedStatus(Int, Foundation.Data)');
        for (const errorCase of method.errorCases) {
            if (errorCase.type === 'Void') {
                writer.line(`case ${escapeKeyword(errorCase.caseName)}`);
            } else {
                const resolved = resolveType(errorCase.type, method.operationName, context, 'operation-enum');
                writer.line(`case ${escapeKeyword(errorCase.caseName)}(${resolved})`);
            }
        }
    });
};

const emitSuccessSumEnum = (writer: SwiftWriter, method: RouteMethod, context: EmitContext): void => {
    if (!method.successSumEnumName) return;
    writer.blank();
    writer.block('public enum Success: Sendable, Equatable', () => {
        for (const successResponse of method.successResponses) {
            const resolved = resolveType(successResponse.type, method.operationName, context, 'operation-enum');
            if (resolved === 'Void') {
                writer.line(`case status${successResponse.status}`);
            } else {
                writer.line(`case status${successResponse.status}(${resolved})`);
            }
        }
    });
};

const emitKizunaFailureProtocols = (writer: SwiftWriter): void => {
    writer.blank();
    writer.block('public protocol KizunaFailure: Swift.Error', () => {
        writer.line('static func requestFailed(_ error: Swift.Error) -> Self');
        writer.line('static var invalidRequest: Self { get }');
        writer.line('static var cancelled: Self { get }');
        writer.line('static var invalidResponse: Self { get }');
        writer.line('static func unexpectedStatus(_ status: Int, _ data: Foundation.Data) -> Self');
    });
    writer.blank();
    writer.block('public protocol KizunaDecodableFailure: KizunaFailure', () => {
        writer.line('static func decoding(_ error: Swift.Error, statusCode: Int, data: Foundation.Data) -> Self');
    });
};

const emitKizunaNamespace = (writer: SwiftWriter, options: { multipart: boolean; multiError: boolean; clientName: string }): void => {
    writer.blank();
    writer.block('private enum Kizuna', () => {
        writer.block('@Sendable static func decodeDate(_ decoder: Decoder) throws -> Date', () => {
            writer.line('let container = try decoder.singleValueContainer()');
            writer.line('let raw = try container.decode(String.self)');
            writer.line(
                'if let date = try? Date(raw, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true)) { return date }'
            );
            writer.line('if let date = try? Date(raw, strategy: Date.ISO8601FormatStyle()) { return date }');
            writer.line('throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid ISO8601 date: \\(raw)")');
        });
        writer.blank();
        writer.block('static func encodeDate(_ date: Date) -> String', () => {
            writer.line('date.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true))');
        });
        writer.blank();
        writer.block('static func makeJSONEncoder() -> JSONEncoder', () => {
            writer.line('let encoder = JSONEncoder()');
            writer.line('encoder.dateEncodingStrategy = .custom { date, encoder in');
            writer.line('    var container = encoder.singleValueContainer()');
            writer.line('    try container.encode(encodeDate(date))');
            writer.line('}');
            writer.line('return encoder');
        });
        writer.blank();
        writer.block('static func makeJSONDecoder() -> JSONDecoder', () => {
            writer.line('let decoder = JSONDecoder()');
            writer.line('decoder.dateDecodingStrategy = .custom(decodeDate)');
            writer.line('return decoder');
        });
        writer.blank();
        writer.line('private static let pathSegmentAllowed: CharacterSet = {');
        writer.line('    var allowed = CharacterSet.urlPathAllowed');
        writer.line('    allowed.remove(charactersIn: "/")');
        writer.line('    return allowed');
        writer.line('}()');
        writer.blank();
        writer.block('static func encodePathSegment<Value>(_ value: Value) -> String', () => {
            writer.line('let text = stringifyQueryValue(value).first ?? ""');
            writer.line('return text.addingPercentEncoding(withAllowedCharacters: pathSegmentAllowed) ?? text');
        });
        writer.blank();
        writer.block('static func appendPath(_ base: URL, _ path: String) -> URL', () => {
            writer.line('base.appending(path: path, directoryHint: .notDirectory)');
        });
        writer.blank();
        writer.block('static func stringifyQueryValue(_ value: Any) -> [String]', () => {
            writer.line('switch value {');
            writer.line('case let date as Date:');
            writer.line('    return [encodeDate(date)]');
            writer.line('case let array as [Any]:');
            writer.line('    return array.flatMap { stringifyQueryValue($0) }');
            writer.line('case let raw as any RawRepresentable where raw.rawValue is CustomStringConvertible:');
            writer.line('    return [String(describing: raw.rawValue)]');
            writer.line('case let convertible as CustomStringConvertible:');
            writer.line('    return [convertible.description]');
            writer.line('default:');
            writer.line('    return [String(describing: value)]');
            writer.line('}');
        });
        writer.blank();
        writer.block('static func queryItems<Value>(name: String, value: Value?) -> [URLQueryItem]', () => {
            writer.line('guard let value else { return [] }');
            writer.line('return stringifyQueryValue(value).map { URLQueryItem(name: name, value: $0) }');
        });
        writer.blank();
        writer.block('static func setHeader<Value>(_ request: inout URLRequest, name: String, value: Value?)', () => {
            writer.line('guard let value else { return }');
            writer.line('request.setValue(stringifyQueryValue(value).joined(separator: ", "), forHTTPHeaderField: name)');
        });
        writer.blank();
        writer.block(
            'static func makeURL<Failure: KizunaFailure>(baseURL: URL, path: String, queryItems: [URLQueryItem], failure: Failure.Type) throws(Failure) -> URL',
            () => {
                writer.line('guard var components = URLComponents(url: appendPath(baseURL, path), resolvingAgainstBaseURL: false) else {');
                writer.line('    throw Failure.invalidRequest');
                writer.line('}');
                writer.line('if !queryItems.isEmpty { components.queryItems = queryItems }');
                writer.line('guard let url = components.url else { throw Failure.invalidRequest }');
                writer.line('return url');
            }
        );
        writer.blank();
        writer.block(
            'static func encodeBody<Value: Encodable, Failure: KizunaFailure>(_ request: inout URLRequest, value: Value, using encoder: JSONEncoder, failure: Failure.Type) throws(Failure)',
            () => {
                writer.line('do { request.httpBody = try encoder.encode(value) }');
                writer.line('catch { throw Failure.requestFailed(error) }');
            }
        );
        writer.blank();
        writer.block(
            'static func send<Failure: KizunaFailure>(_ request: inout URLRequest, session: URLSession, requestMiddleware: (@Sendable (inout URLRequest) async throws -> Void)?, responseMiddleware: (@Sendable (URLRequest, Foundation.Data, URLResponse) async -> Void)?, failure: Failure.Type) async throws(Failure) -> (Foundation.Data, Int, HTTPURLResponse)',
            () => {
                writer.line('if let requestMiddleware {');
                writer.line('    do { try await requestMiddleware(&request) }');
                writer.line('    catch is CancellationError { throw Failure.cancelled }');
                writer.line('    catch { throw Failure.requestFailed(error) }');
                writer.line('}');
                writer.line('let data: Foundation.Data');
                writer.line('let response: URLResponse');
                writer.line('do { (data, response) = try await session.data(for: request) }');
                writer.line('catch is CancellationError { throw Failure.cancelled }');
                writer.line('catch { throw Failure.requestFailed(error) }');
                writer.line('if let responseMiddleware { await responseMiddleware(request, data, response) }');
                writer.line('guard let httpResponse = response as? HTTPURLResponse else { throw Failure.invalidResponse }');
                writer.line('return (data, httpResponse.statusCode, httpResponse)');
            }
        );
        writer.blank();
        writer.block(
            'static func decode<Value: Decodable, Failure: KizunaDecodableFailure>(_ type: Value.Type, from data: Foundation.Data, using decoder: JSONDecoder, statusCode: Int, failure: Failure.Type) throws(Failure) -> Value',
            () => {
                writer.line('do { return try decoder.decode(Value.self, from: data) }');
                writer.line('catch { throw Failure.decoding(error, statusCode: statusCode, data: data) }');
            }
        );
        if (options.multiError) {
            // One status code, several candidate body types: return the first attempt that produces a
            // failure, else a `.decoding` error carrying the raw payload.
            writer.blank();
            writer.block(
                'static func firstError<Failure: KizunaDecodableFailure>(statusCode: Int, data: Foundation.Data, _ attempts: [() -> Failure?]) -> Failure',
                () => {
                    writer.line('for attempt in attempts {');
                    writer.line('    if let failure = attempt() { return failure }');
                    writer.line('}');
                    writer.line(
                        'return Failure.decoding(DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "No matching type for status \\(statusCode)")), statusCode: statusCode, data: data)'
                    );
                }
            );
        }
        if (options.multipart) {
            writer.blank();
            writer.block('struct MultipartBuilder', () => {
                writer.line('let boundary: String');
                writer.line('private var data = Foundation.Data()');
                writer.blank();
                writer.block('init(boundary: String = "kizuna-\\(UUID().uuidString)")', () => {
                    writer.line('self.boundary = boundary');
                });
                writer.blank();
                writer.block('mutating func appendField(name: String, value: String)', () => {
                    writer.line('data.append("--\\(boundary)\\r\\n".data(using: .utf8)!)');
                    writer.line('data.append("Content-Disposition: form-data; name=\\"\\(name)\\"\\r\\n\\r\\n".data(using: .utf8)!)');
                    writer.line('data.append(value.data(using: .utf8)!)');
                    writer.line('data.append("\\r\\n".data(using: .utf8)!)');
                });
                writer.blank();
                writer.block(`mutating func appendFile(name: String, file: ${options.clientName}.MultipartFile)`, () => {
                    writer.line('data.append("--\\(boundary)\\r\\n".data(using: .utf8)!)');
                    writer.line(
                        'data.append("Content-Disposition: form-data; name=\\"\\(name)\\"; filename=\\"\\(file.filename)\\"\\r\\n".data(using: .utf8)!)'
                    );
                    writer.line('data.append("Content-Type: \\(file.mimeType)\\r\\n\\r\\n".data(using: .utf8)!)');
                    writer.line('data.append(file.data)');
                    writer.line('data.append("\\r\\n".data(using: .utf8)!)');
                });
                writer.blank();
                writer.block('func finalize() -> Foundation.Data', () => {
                    writer.line('var result = data');
                    writer.line('result.append("--\\(boundary)--\\r\\n".data(using: .utf8)!)');
                    writer.line('return result');
                });
                writer.blank();
                writer.block('var contentType: String', () => {
                    writer.line('"multipart/form-data; boundary=\\(boundary)"');
                });
            });
        }
    });
};

// ----- Struct-based call surface -----
//
// Each request group (params / query / headers / body) is emitted as a typed struct with a group-named
// static factory; a field reads back as `group.field`.

const pathParamFields = (method: RouteMethod): SwiftField[] =>
    method.pathParams.map((name) => {
        const declared = method.declaredPathParams.find((field) => field.wireName === name);
        return declared ? { ...declared, optional: false } : { name, wireName: name, type: 'String', optional: false };
    });

const registryStruct = (typeName: string, context: EmitContext): Extract<SwiftType, { kind: 'struct' }> | undefined => {
    const found = context.registry.get(typeName);
    return found && found.kind === 'struct' && found.fields.length > 0 ? found : undefined;
};

// How to read one field out of a group struct (`group.field`).
const groupMemberAccessor = (groupLabel: string, field: SwiftField): string => `${groupLabel}.${escapeKeyword(field.name)}`;

const groupTypeRef = (operationName: string, structName: string, context: EmitContext): string =>
    `${context.clientName}.${operationName}.${structName}`;

// The body's `Body` group type, or undefined when the body carries no call-site value (empty/void).
const bodyParamType = (method: RouteMethod, context: EmitContext): string | undefined => {
    if (!method.body || method.body.kind === 'json-empty') return undefined;
    return groupTypeRef(method.operationName, 'Body', context);
};

type MethodGroup = { varName: string; type: string; factory: string; required: boolean };

// The request groups of a method, required ones first. A group is required when it has any required field
// (path params and object bodies always do); optional groups sort last so they can carry trailing defaults.
const methodGroups = (method: RouteMethod, context: EmitContext): MethodGroup[] => {
    const operationName = method.operationName;
    const groups: MethodGroup[] = [];

    if (method.pathParams.length > 0) {
        groups.push({ varName: 'params', type: groupTypeRef(operationName, 'Params', context), factory: 'params', required: true });
    }
    const bodyType = bodyParamType(method, context);
    if (bodyType) {
        groups.push({ varName: 'body', type: bodyType, factory: 'body', required: true });
    }
    if (method.query.length > 0) {
        groups.push({
            varName: 'query',
            type: groupTypeRef(operationName, 'Query', context),
            factory: 'query',
            required: method.query.some((field) => !field.optional),
        });
    }
    if (method.headers.length > 0) {
        groups.push({
            varName: 'headers',
            type: groupTypeRef(operationName, 'Headers', context),
            factory: 'headers',
            required: method.headers.some((field) => !field.optional),
        });
    }

    return [...groups.filter((group) => group.required), ...groups.filter((group) => !group.required)];
};

// Each request group is a positional parameter typed as its group struct. Required groups are non-defaulted;
// optional groups get a `.factory()` default so they can be omitted.
const buildMethodParameters = (method: RouteMethod, context: EmitContext): string[] =>
    methodGroups(method, context).map((group) => `_ ${group.varName}: ${group.type}${group.required ? '' : ` = .${group.factory}()`}`);

const deprecatedAttribute = (message: string | undefined): string => {
    if (message === undefined || message === '') return '@available(*, deprecated)';
    return `@available(*, deprecated, message: ${stringLiteral(message)})`;
};

const failureRef = (method: RouteMethod, context: EmitContext): string =>
    `${context.clientName}.${method.operationName}.${method.failureEnumName}`;

/**
 * Statement that binds `name` to the decoded response body. JSON responses go
 * through `Kizuna.decode`; binary responses are the raw `Data`; other raw
 * (non-JSON) responses are read as a UTF-8 string.
 */
const decodeBodyStatement = (
    name: string,
    resolvedType: string,
    response: { isRaw: boolean; isBinary: boolean },
    failure: string,
    receiver = ''
): string => {
    if (response.isBinary) return `    let ${name} = data`;
    if (response.isRaw) return `    let ${name} = String(decoding: data, as: UTF8.self)`;
    return `    let ${name} = try Kizuna.decode(${resolvedType}.self, from: data, using: ${receiver}decoder, statusCode: statusCode, failure: ${failure}.self)`;
};

// Whether any status code maps to more than one error body type — the case that needs `Kizuna.firstError`.
const hasMultiErrorGroup = (method: RouteMethod): boolean => {
    const counts = new Map<number, number>();
    for (const errorCase of method.errorCases) {
        counts.set(errorCase.status, (counts.get(errorCase.status) ?? 0) + 1);
    }
    return [...counts.values()].some((count) => count > 1);
};

// `receiver` prefixes the stored properties the body reads (baseURL, session, encoder, …): empty inside the
// client itself, `client.` inside a sub-client struct that forwards to its parent client.
const emitMethodBody = (writer: SwiftWriter, method: RouteMethod, context: EmitContext, receiver = ''): void => {
    const failure = failureRef(method, context);
    const pathDecl = method.pathParams.length > 0 ? 'var' : 'let';
    writer.line(`${pathDecl} path = ${stringLiteral(method.pathTemplate)}`);
    for (const field of pathParamFields(method)) {
        const accessor = groupMemberAccessor('params', field);
        writer.line(
            `path = path.replacingOccurrences(of: ${stringLiteral(`:${field.name}`)}, with: Kizuna.encodePathSegment(${accessor}))`
        );
    }

    let queryItemsExpression = '[]';
    if (method.query.length > 0) {
        writer.line('var queryItems: [URLQueryItem] = []');
        for (const field of method.query) {
            const accessor = groupMemberAccessor('query', field);
            writer.line(`queryItems += Kizuna.queryItems(name: ${stringLiteral(field.wireName)}, value: ${accessor})`);
        }
        queryItemsExpression = 'queryItems';
    }

    writer.line(
        `let url = try Kizuna.makeURL(baseURL: ${receiver}baseURL, path: path, queryItems: ${queryItemsExpression}, failure: ${failure}.self)`
    );
    writer.line(`var request = URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: ${receiver}timeout)`);
    writer.line(`request.httpMethod = ${stringLiteral(method.method)}`);
    if (context.requestContextFields.length > 0) {
        writer.line(`for (name, value) in ${receiver}requestContextHeaders { request.setValue(value, forHTTPHeaderField: name) }`);
    }

    if (method.body) {
        emitBodyEncoding(writer, method, context, receiver);
    }

    for (const field of method.headers) {
        const accessor = groupMemberAccessor('headers', field);
        writer.line(`Kizuna.setHeader(&request, name: ${stringLiteral(field.wireName)}, value: ${accessor})`);
    }

    const responseBinding = method.resultHeaderFields.length > 0 ? 'httpResponse' : '_';
    writer.line(
        `let (data, statusCode, ${responseBinding}) = try await Kizuna.send(&request, session: ${receiver}session, requestMiddleware: ${receiver}requestMiddleware, responseMiddleware: ${receiver}responseMiddleware, failure: ${failure}.self)`
    );

    writer.line('switch statusCode {');
    for (const successResponse of method.successResponses) {
        writer.line(`case ${successResponse.status}:`);
        if (method.resultWrapperName) {
            const qualifiedResult = `${context.clientName}.${method.operationName}.${method.resultWrapperName}`;
            const hasHeaders = method.resultHeaderFields.length > 0;
            const headersInitArgs = method.resultHeaderFields
                .map((field) => `${escapeKeyword(field.name)}: ${escapeKeyword(field.name)}`)
                .join(', ');
            if (method.successSumEnumName) {
                const resolved = resolveType(successResponse.type, method.operationName, context);
                if (resolved === 'Void') {
                    for (const field of successResponse.responseHeaders) {
                        writer.line(
                            `    let ${escapeKeyword(field.name)} = httpResponse.value(forHTTPHeaderField: ${stringLiteral(field.wireName)})`
                        );
                    }
                    if (hasHeaders) {
                        writer.line(
                            `    return ${qualifiedResult}(body: .status${successResponse.status}, headers: .init(${headersInitArgs}))`
                        );
                    } else {
                        writer.line(`    return ${qualifiedResult}(body: .status${successResponse.status})`);
                    }
                } else {
                    writer.line(decodeBodyStatement('payload', resolved, successResponse, failure, receiver));
                    for (const field of successResponse.responseHeaders) {
                        writer.line(
                            `    let ${escapeKeyword(field.name)} = httpResponse.value(forHTTPHeaderField: ${stringLiteral(field.wireName)})`
                        );
                    }
                    if (hasHeaders) {
                        writer.line(
                            `    return ${qualifiedResult}(body: .status${successResponse.status}(payload), headers: .init(${headersInitArgs}))`
                        );
                    } else {
                        writer.line(`    return ${qualifiedResult}(body: .status${successResponse.status}(payload))`);
                    }
                }
            } else {
                const resolved = resolveType(successResponse.type, method.operationName, context);
                writer.line(decodeBodyStatement('body', resolved, successResponse, failure, receiver));
                for (const field of successResponse.responseHeaders) {
                    writer.line(
                        `    let ${escapeKeyword(field.name)} = httpResponse.value(forHTTPHeaderField: ${stringLiteral(field.wireName)})`
                    );
                }
                if (hasHeaders) {
                    writer.line(`    return ${qualifiedResult}(body: body, headers: .init(${headersInitArgs}))`);
                } else {
                    writer.line(`    return ${qualifiedResult}(body: body)`);
                }
            }
        } else {
            writer.line('    return');
        }
    }
    const grouped = new Map<number, typeof method.errorCases>();
    for (const errorCase of method.errorCases) {
        const existing = grouped.get(errorCase.status);
        if (existing) {
            existing.push(errorCase);
        } else {
            grouped.set(errorCase.status, [errorCase]);
        }
    }
    for (const [status, cases] of grouped) {
        writer.line(`case ${status}:`);
        const firstCase = cases[0];
        if (cases.length === 1 && firstCase) {
            if (firstCase.type === 'Void') {
                writer.line(`    throw ${failure}.${escapeKeyword(firstCase.caseName)}`);
            } else {
                const resolved = resolveType(firstCase.type, method.operationName, context);
                writer.line(decodeBodyStatement('payload', resolved, firstCase, failure, receiver));
                writer.line(`    throw ${failure}.${escapeKeyword(firstCase.caseName)}(payload)`);
            }
        } else {
            writer.line(`    throw Kizuna.firstError(statusCode: statusCode, data: data, [`);
            for (const errorCase of cases) {
                const caseRef = `${failure}.${escapeKeyword(errorCase.caseName)}`;
                if (errorCase.type === 'Void') {
                    writer.line(`        { ${caseRef} },`);
                } else if (errorCase.isBinary) {
                    writer.line(`        { ${caseRef}(data) },`);
                } else if (errorCase.isRaw) {
                    writer.line(`        { ${caseRef}(String(decoding: data, as: UTF8.self)) },`);
                } else {
                    const resolved = resolveType(errorCase.type, method.operationName, context);
                    writer.line(`        { (try? ${receiver}decoder.decode(${resolved}.self, from: data)).map(${caseRef}) },`);
                }
            }
            writer.line('    ])');
        }
    }
    writer.line('default:');
    writer.line(`    throw ${failure}.unexpectedStatus(statusCode, data)`);
    writer.line('}');
};

const methodSuccessType = (method: RouteMethod, context: EmitContext): string => {
    const { clientName } = context;
    if (method.resultWrapperName) {
        return `${clientName}.${method.operationName}.${method.resultWrapperName}`;
    }
    if (method.successReturnType === 'Void') {
        return 'Void';
    }
    if (method.successSumEnumName) {
        return `${clientName}.${method.operationName}.Success`;
    }
    return resolveType(method.successReturnType, method.operationName, context);
};

const buildMethodSignature = (method: RouteMethod, context: EmitContext): string => {
    const failure = failureRef(method, context);
    const params = buildMethodParameters(method, context);
    const successType = methodSuccessType(method, context);
    const returnType = successType === 'Void' ? '' : ` -> ${successType}`;
    return `public func ${escapeKeyword(method.name)}(${params.join(', ')}) async throws(${failure})${returnType}`;
};

const emitMethod = (writer: SwiftWriter, method: RouteMethod, context: EmitContext): void => {
    writer.docComment(method.summary ?? method.description);
    if (method.deprecated) {
        writer.line(deprecatedAttribute(method.deprecationMessage));
    }
    writer.block(buildMethodSignature(method, context), () => {
        emitMethodBody(writer, method, context);
    });
};

const emitSubClientMethod = (writer: SwiftWriter, method: RouteMethod, context: EmitContext): void => {
    writer.docComment(method.summary ?? method.description);
    if (method.deprecated) {
        writer.line(deprecatedAttribute(method.deprecationMessage));
    }
    writer.block(buildMethodSignature(method, context), () => {
        emitMethodBody(writer, method, context, 'client.');
    });
};

const emitSubClientStruct = (writer: SwiftWriter, group: RouteGroup, clientName: string, context: EmitContext): void => {
    writer.blank();
    writer.block(`public struct ${group.structName}: Sendable`, () => {
        writer.line(`private let client: ${clientName}`);
        writer.blank();
        writer.block(`init(client: ${clientName})`, () => {
            writer.line('self.client = client');
        });
        for (const method of group.methods) {
            writer.blank();
            emitSubClientMethod(writer, method, context);
        }
    });
};

const emitBodyEncoding = (writer: SwiftWriter, method: RouteMethod, context: EmitContext, receiver = ''): void => {
    if (!method.body) return;
    const body = method.body;
    const failure = failureRef(method, context);

    if (body.kind === 'multipart') {
        writer.line('var multipart = Kizuna.MultipartBuilder()');
        for (const field of body.multipartFields) {
            const flattenedField = body.flattened.find((candidate) => candidate.name === field.name);
            const accessor = `body.${escapeKeyword(field.name)}`;
            if (field.isFile || flattenedField?.isFile === true) {
                writer.line(`multipart.appendFile(name: ${stringLiteral(field.wireName)}, file: ${accessor})`);
            } else {
                writer.line(`multipart.appendField(name: ${stringLiteral(field.wireName)}, value: String(describing: ${accessor}))`);
            }
        }
        writer.line('request.httpBody = multipart.finalize()');
        writer.line('request.setValue(multipart.contentType, forHTTPHeaderField: "Content-Type")');
        return;
    }

    writer.line('request.setValue("application/json", forHTTPHeaderField: "Content-Type")');
    if (body.kind === 'json-empty') {
        writer.line('request.httpBody = Data("{}".utf8)');
        return;
    }
    // Object / non-object / union bodies: the `Body` group wraps the Codable payload.
    writer.line(`try Kizuna.encodeBody(&request, value: body.payload, using: ${receiver}encoder, failure: ${failure}.self)`);
};

const emitClient = (
    writer: SwiftWriter,
    config: { clientName: string; anyCodable: boolean },
    partition: RoutesPartition,
    context: EmitContext,
    typesByOperation: Map<string, SwiftType[]>
): void => {
    const { clientName } = config;
    const { flatMethods, groups } = partition;
    const allMethods = [...flatMethods, ...groups.flatMap((group) => group.methods)];

    const usesMultipart = allMethods.some((method) => method.body?.kind === 'multipart');

    const contextFields = context.requestContextFields;
    const contextRequired = contextFields.some((field) => !field.optional);

    writer.blank();
    writer.block(`public final class ${clientName}: Sendable`, () => {
        if (contextFields.length > 0) {
            writer.blank();
            writer.docComment("Values sent as headers on every request, from the contract's request context.");
            writer.block('public struct RequestContext: Sendable, Equatable', () => {
                for (const field of contextFields) {
                    writer.line(`public var ${escapeKeyword(field.name)}: ${field.type}`);
                }
                writer.blank();
                const initParams = contextFields
                    .map((field) => `${escapeKeyword(field.name)}: ${field.type}${field.optional ? ' = nil' : ''}`)
                    .join(', ');
                writer.block(`public init(${initParams})`, () => {
                    for (const field of contextFields) {
                        writer.line(`self.${escapeKeyword(field.name)} = ${escapeKeyword(field.name)}`);
                    }
                });
                writer.blank();
                writer.block('var headerFields: [String: String]', () => {
                    writer.line('var fields: [String: String] = [:]');
                    for (const field of contextFields) {
                        if (field.optional) {
                            writer.line(
                                `if let ${escapeKeyword(field.name)} { fields[${stringLiteral(field.wireName)}] = ${escapeKeyword(field.name)} }`
                            );
                        } else {
                            writer.line(`fields[${stringLiteral(field.wireName)}] = ${escapeKeyword(field.name)}`);
                        }
                    }
                    writer.line('return fields');
                });
            });
        }
        if (usesMultipart) {
            writer.blank();
            writer.block('public struct MultipartFile: Sendable, Equatable', () => {
                writer.line('public let data: Foundation.Data');
                writer.line('public let filename: String');
                writer.line('public let mimeType: String');
                writer.blank();
                writer.block('public init(data: Data, filename: String, mimeType: String = "application/octet-stream")', () => {
                    writer.line('self.data = data');
                    writer.line('self.filename = filename');
                    writer.line('self.mimeType = mimeType');
                });
            });
        }
        const hasValidation = allMethods.some((method) => method.errorCases.some((c) => c.type === 'ValidationError'));
        if (hasValidation) {
            writer.blank();
            writer.block('public struct ValidationError: Codable, Sendable, Equatable', () => {
                writer.line('public let type: String');
                writer.line('public let title: String');
                writer.line('public let status: Int');
                writer.line('public let detail: String');
                writer.line('public let errors: [ValidationIssue]');
                writer.blank();
                writer.block('public init(type: String, title: String, status: Int, detail: String, errors: [ValidationIssue])', () => {
                    writer.line('self.type = type');
                    writer.line('self.title = title');
                    writer.line('self.status = status');
                    writer.line('self.detail = detail');
                    writer.line('self.errors = errors');
                });
            });
            writer.blank();
            writer.block('public struct ValidationIssue: Codable, Sendable, Equatable', () => {
                writer.line('public let code: String');
                writer.line('public let path: [String]');
                writer.line('public let message: String');
                writer.blank();
                writer.block('public init(code: String, path: [String], message: String)', () => {
                    writer.line('self.code = code');
                    writer.line('self.path = path');
                    writer.line('self.message = message');
                });
            });
        }
        if (config.anyCodable) {
            writer.blank();
            writer.docComment('A decoded JSON value of unknown shape. Codable and correctly Equatable by structure.');
            writer.block('public enum JSONValue: Codable, Sendable, Equatable', () => {
                writer.line('case null');
                writer.line('case bool(Bool)');
                writer.line('case int(Int)');
                writer.line('case double(Double)');
                writer.line('case string(String)');
                writer.line('case array([JSONValue])');
                writer.line('case object([String: JSONValue])');
                writer.blank();
                writer.block('public init(from decoder: Decoder) throws', () => {
                    writer.line('let container = try decoder.singleValueContainer()');
                    writer.line('if container.decodeNil() {');
                    writer.line('    self = .null');
                    writer.line('} else if let value = try? container.decode(Bool.self) {');
                    writer.line('    self = .bool(value)');
                    writer.line('} else if let value = try? container.decode(Int.self) {');
                    writer.line('    self = .int(value)');
                    writer.line('} else if let value = try? container.decode(Double.self) {');
                    writer.line('    self = .double(value)');
                    writer.line('} else if let value = try? container.decode(String.self) {');
                    writer.line('    self = .string(value)');
                    writer.line('} else if let value = try? container.decode([JSONValue].self) {');
                    writer.line('    self = .array(value)');
                    writer.line('} else if let value = try? container.decode([String: JSONValue].self) {');
                    writer.line('    self = .object(value)');
                    writer.line('} else {');
                    writer.line('    throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value")');
                    writer.line('}');
                });
                writer.blank();
                writer.block('public func encode(to encoder: Encoder) throws', () => {
                    writer.line('var container = encoder.singleValueContainer()');
                    writer.line('switch self {');
                    writer.line('case .null: try container.encodeNil()');
                    writer.line('case .bool(let value): try container.encode(value)');
                    writer.line('case .int(let value): try container.encode(value)');
                    writer.line('case .double(let value): try container.encode(value)');
                    writer.line('case .string(let value): try container.encode(value)');
                    writer.line('case .array(let value): try container.encode(value)');
                    writer.line('case .object(let value): try container.encode(value)');
                    writer.line('}');
                });
            });
        }
        writer.line('public let baseURL: URL');
        writer.line('public let session: URLSession');
        writer.line('public let timeout: TimeInterval');
        if (contextFields.length > 0) {
            writer.line('let requestContextHeaders: [String: String]');
        }
        writer.line('public let requestMiddleware: (@Sendable (inout URLRequest) async throws -> Void)?');
        writer.line('public let responseMiddleware: (@Sendable (URLRequest, Foundation.Data, URLResponse) async -> Void)?');
        writer.line('let encoder: JSONEncoder');
        writer.line('let decoder: JSONDecoder');
        writer.blank();
        const contextInitParam =
            contextFields.length > 0 ? `, requestContext: RequestContext${contextRequired ? '' : ' = RequestContext()'}` : '';
        writer.block(
            `public init(baseURL: URL, session: URLSession = .shared, timeout: TimeInterval = 30${contextInitParam}, requestMiddleware: (@Sendable (inout URLRequest) async throws -> Void)? = nil, responseMiddleware: (@Sendable (URLRequest, Foundation.Data, URLResponse) async -> Void)? = nil)`,
            () => {
                writer.line('self.baseURL = baseURL');
                writer.line('self.session = session');
                writer.line('self.timeout = timeout');
                if (contextFields.length > 0) {
                    writer.line('self.requestContextHeaders = requestContext.headerFields');
                }
                writer.line('self.requestMiddleware = requestMiddleware');
                writer.line('self.responseMiddleware = responseMiddleware');
                writer.line('self.encoder = Kizuna.makeJSONEncoder()');
                writer.line('self.decoder = Kizuna.makeJSONDecoder()');
            }
        );

        if (groups.length > 0) {
            for (const group of groups) {
                writer.blank();
                writer.block(`public var ${escapeKeyword(group.propertyName)}: ${group.structName}`, () => {
                    writer.line(`${group.structName}(client: self)`);
                });
            }
        }

        for (const method of allMethods) {
            const localTypes = (typesByOperation.get(method.operationName) ?? []).map((type) =>
                localizeType(type, method.operationName, context)
            );
            writer.blank();
            writer.block(`public enum ${method.operationName}`, () => {
                emitTypes(writer, localTypes, context);
                emitRequestGroupStructs(writer, method, context);
                emitSuccessSumEnum(writer, method, context);
                emitResultStruct(writer, method, context);
                emitFailureEnum(writer, method, context);
            });
        }

        for (const method of flatMethods) {
            writer.blank();
            emitMethod(writer, method, context);
        }
    });
};

/**
 * Generate a Swift API client from a kizuna config.
 *
 *   - `namespaceName` — the actor class. Defaults to `APIClient`.
 */
export const generateSwiftClient = (contract: Contract, options: SwiftConfig): string => {
    const { namespaceName, camelCaseProperties = false, unknownEnumCase = false } = options;

    const registry = new TypeRegistry(camelCaseProperties, unknownEnumCase);
    const partition = swiftGenerator(contract, {
        namespaceName,
        registry,
    });
    const allMethods = [...partition.flatMethods, ...partition.groups.flatMap((group: RouteGroup) => group.methods)];

    const operationTypeMap = buildOperationTypeMap(allMethods, registry);
    const clientName = `${namespaceName}Client`;

    const writer = new SwiftWriter();
    writer.line('// Generated by @ts-kizuna/swift. Do not edit by hand.');
    writer.blank();
    writer.line('import Foundation');
    writer.line('#if canImport(FoundationNetworking)');
    writer.line('import FoundationNetworking');
    writer.line('#endif');
    writer.blank();

    const usesMultipart = allMethods.some((method) => method.body?.kind === 'multipart');
    const usesMultiError = allMethods.some(hasMultiErrorGroup);

    // Split registry types:
    //   - operation-local → per-operation enum inside the actor
    //   - all shared named types (structs + enums) → API. namespace (user-visible models)
    //   - AnyCodable → file level only (implementation helper, not a model)
    const sharedTypes: SwiftType[] = [];
    const typesByOperation = new Map<string, SwiftType[]>();
    for (const type of registry.all()) {
        const owningOp = operationTypeMap.get(type.name);
        if (owningOp !== undefined) {
            const bucket = typesByOperation.get(owningOp) ?? [];
            if (bucket.length === 0) typesByOperation.set(owningOp, bucket);
            bucket.push(type);
        } else {
            sharedTypes.push(type);
        }
    }
    const fileLevelTypeNames = new Set<string>();

    const allStructNames = sharedTypes.filter((type) => type.kind === 'struct').map((type) => type.name);
    const ownedTypeMap = new Map<string, string>();
    for (const type of sharedTypes) {
        if (registry.isExplicitId(type.name)) continue;
        let bestMatch: string | undefined;
        for (const structName of allStructNames) {
            if (structName === type.name) continue;
            if (isHintPrefix(type.name, structName) && (!bestMatch || structName.length > bestMatch.length)) {
                bestMatch = structName;
            }
        }
        if (bestMatch !== undefined) ownedTypeMap.set(type.name, bestMatch);
    }
    const ownedTypeLookup = new Map(sharedTypes.filter((type) => ownedTypeMap.has(type.name)).map((type) => [type.name, type]));
    const topLevelSharedTypes = sharedTypes.filter((type) => !ownedTypeMap.has(type.name));

    const requestContextFields: SwiftField[] = [];
    for (const declaration of Object.values(contract.requestContext ?? {})) {
        const headersSchema = (declaration as { headers?: z.ZodType }).headers;
        if (!headersSchema) continue;
        requestContextFields.push(...collectObjectFields(headersSchema, registry, 'RequestContext', undefined, 'headers', undefined));
    }

    const context: EmitContext = {
        namespaceName,
        clientName,
        operationTypeMap,
        fileLevelTypeNames,
        ownedTypeMap,
        registry,
        requestContextFields,
    };

    writer.block(`public enum ${namespaceName}`, () => {
        emitTypes(writer, topLevelSharedTypes, context, ownedTypeMap, ownedTypeLookup);
    });

    emitClient(writer, { clientName, anyCodable: registry.usesAnyCodable }, partition, context, typesByOperation);

    for (const group of partition.groups) {
        emitSubClientStruct(writer, group, clientName, context);
    }

    emitKizunaFailureProtocols(writer);

    emitKizunaNamespace(writer, {
        multipart: usesMultipart,
        multiError: usesMultiError,
        clientName,
    });

    for (const warning of registry.warnings()) {
        process.stderr.write(`[ts-kizuna/swift] AnyCodable fallback at ${warning}\n`);
    }

    return writer.toString();
};
