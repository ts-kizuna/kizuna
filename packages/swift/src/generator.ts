import type { z } from 'zod';
import {
    resolveDeprecationMap,
    createGenerator,
    parsePath,
    resolveResponseBody,
    resolveResponseHeaders,
    type Contract,
    type DeprecationWarnings,
    type RouteDefinition,
} from '@ts-kizuna/core/generator';
import { SwiftWriter, camelCase, pascalCase, stringLiteral } from './emit.js';
import {
    TypeRegistry,
    mapType,
    collectObjectFields,
    isObjectSchema,
    isDiscriminatedUnionSchema,
    objectFieldCount,
    objectShapeKeys,
    readMetaId,
    type SwiftField,
    type SwiftType,
} from './zod-to-swift.js';

export interface SwiftConfig {
    namespaceName: string;
    /**
     * Surface `@deprecated` JSDoc tags from the contract source as
     * `@available(*, deprecated)` in the Swift output.
     *
     * Pass `{ contractPath }` to parse from source, a `DeprecationMap`,
     * or a `SerializedDeprecationMap` (JSON import from the tsdown plugin).
     */
    deprecationWarnings?: DeprecationWarnings;
}

const BODY_FLATTEN_MAX_FIELDS = 6;

const statusName = (status: number): string => {
    const known: Record<number, string> = {
        400: 'badRequest',
        401: 'unauthorized',
        403: 'forbidden',
        404: 'notFound',
        405: 'methodNotAllowed',
        409: 'conflict',
        410: 'gone',
        422: 'unprocessableEntity',
        429: 'tooManyRequests',
        500: 'internalServerError',
        502: 'badGateway',
        503: 'serviceUnavailable',
    };
    return known[status] ?? `status${status}`;
};

const isSuccessStatus = (status: number): boolean => status >= 200 && status < 300;

const mergeHeaderFields = (perStatusHeaders: SwiftField[][]): SwiftField[] => {
    const nonEmpty = perStatusHeaders.filter((fields) => fields.length > 0);
    if (nonEmpty.length === 0) return [];
    const first = nonEmpty[0]!;
    return first.map((field) => {
        const universallyPresent = nonEmpty.every((fields) => fields.some((candidate) => candidate.name === field.name));
        return universallyPresent ? field : { ...field, optional: true };
    });
};

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
    }>;
    successReturnType: string;
    successSumEnumName?: string;
    failureEnumName: string;
    errorCases: Array<{
        caseName: string;
        status: number;
        type: string;
    }>;
}

interface RouteGroup {
    groupKey: string;
    structName: string;
    propertyName: string;
    methods: RouteMethod[];
}

interface ContractPartition {
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
}

const shortTypeName = (typeName: string, structName: string): string =>
    typeName.startsWith(structName) ? typeName.slice(structName.length) : typeName;

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
              .map((segment, index) => (index === 0 ? segment : pascalCase(segment)))
              .join('')
        : routeKey;
    const methodName = methodNameOverride ?? fullJoinedName;
    const baseHint = pascalCase(fullJoinedName);
    const pathParams = parsePath(route.path).paramNames;

    const queryFields: SwiftField[] = route.query
        ? collectObjectFields(route.query as z.ZodType, registry, `${baseHint}Query`, fieldPaths, 'query', deprecationSchemas)
        : [];

    const headerFields: SwiftField[] = route.headers
        ? collectObjectFields(route.headers as z.ZodType, registry, `${baseHint}Headers`, fieldPaths, 'headers', deprecationSchemas)
        : [];

    const bodyDefType =
        (route.body as unknown as { _def?: { type?: string }; def?: { type?: string } } | undefined)?._def?.type ??
        (route.body as unknown as { _def?: { type?: string }; def?: { type?: string } } | undefined)?.def?.type;
    let bodyDescriptor: BodyDescriptor | undefined;
    if (route.body && bodyDefType !== 'void') {
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
            const multipartFields = objectShapeKeys(route.body as z.ZodType);
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
                const useStruct = !isObject || fieldCount > BODY_FLATTEN_MAX_FIELDS;
                const result = mapType(route.body as z.ZodType, registry, bodyHint, fieldPaths, 'body', deprecationSchemas);
                const structName = result.expression;

                if (useStruct) {
                    bodyDescriptor = {
                        kind: 'json-struct',
                        structName,
                        flattened: [],
                        multipartFields: [],
                    };
                } else {
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
            });
        } else {
            errorCases.push({
                caseName: statusName(status),
                status,
                type: typeExpression,
            });
        }
    }
    const hasValidation = route.body || route.query;
    if (hasValidation) {
        const has400 = errorCases.some((c) => c.status === 400);
        errorCases.push({
            caseName: has400 ? 'validationError' : statusName(400),
            status: 400,
            type: 'ValidationError',
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

const swiftGenerator = createGenerator((options: SwiftConfig & { registry: TypeRegistry }) => {
    const flatMethods: RouteMethod[] = [];
    const groupMap = new Map<string, RouteMethod[]>();
    const deprecationSchemas = resolveDeprecationMap(options.deprecationWarnings)?.schemas;

    return {
        processRoute({ routeKey, route, deprecated, deprecationMessage, fieldDeprecations }) {
            const dotIndex = routeKey.indexOf('.');
            if (dotIndex !== -1) {
                const groupKey = routeKey.slice(0, dotIndex);
                const remainder = routeKey.slice(dotIndex + 1);
                const leafName = remainder
                    .split('.')
                    .map((segment: string, index: number) => (index === 0 ? segment : pascalCase(segment)))
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

        finalize(): ContractPartition {
            const groups: RouteGroup[] = [];
            for (const [groupKey, methods] of groupMap) {
                groups.push({
                    groupKey,
                    structName: `${options.namespaceName}${pascalCase(groupKey)}Client`,
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

/**
 * Turn an arbitrary enum value (e.g. `"image/jpeg"`) into a valid Swift case
 * identifier (`imageJpeg`). The original value is preserved as the rawValue, so
 * only the case name needs sanitizing: non-identifier characters are stripped
 * via camelCase, and a leading digit is prefixed since Swift identifiers cannot
 * start with one. Falls back to `_` when nothing identifier-safe remains.
 */
const sanitizeEnumCaseName = (value: string): string => {
    const camel = camelCase(value);
    if (!camel) return '_';
    return /^[0-9]/.test(camel) ? `_${camel}` : camel;
};

const optionalize = (type: string, optional: boolean): string => {
    if (!optional) return type;
    return type.endsWith('?') ? type : `${type}?`;
};

const emitMemberwiseInit = (writer: SwiftWriter, fields: SwiftField[]): void => {
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
                writer.line(`self.${escapeKeyword(field.name)} = ${escapeKeyword(field.name)}`);
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
            writer.line(`self.${escapeKeyword(field.name)} = ${escapeKeyword(field.name)}`);
        }
    });
};

const emitStringEnum = (writer: SwiftWriter, name: string, cases: string[], description?: string): void => {
    writer.blank();
    writer.docComment(description);
    writer.block(`public enum ${name}: String, Codable, Sendable`, () => {
        for (const caseName of cases) {
            writer.line(`case ${escapeKeyword(sanitizeEnumCaseName(caseName))} = ${stringLiteral(caseName)}`);
        }
    });
};

const emitTypes = (
    writer: SwiftWriter,
    types: SwiftType[],
    ownedTypeMap: Map<string, string> = new Map(),
    ownedTypeLookup: Map<string, SwiftType> = new Map()
): void => {
    for (const type of types) {
        writer.blank();
        writer.docComment(type.description);
        if (type.kind === 'struct') {
            emitStruct(writer, type, ownedTypeMap, ownedTypeLookup);
        } else if (type.kind === 'enum') {
            emitStringEnum(writer, type.name, type.cases, type.description);
        } else {
            emitDiscriminatedEnum(writer, type);
        }
    }
};

const emitStruct = (
    writer: SwiftWriter,
    type: Extract<SwiftType, { kind: 'struct' }>,
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

    const needsCodingKeys = !hasFile && type.fields.some((field) => field.name !== field.wireName || SWIFT_KEYWORDS.has(field.name));
    writer.block(`public struct ${type.name}: ${conformances}`, () => {
        for (const [ownedName, owningStruct] of ownedTypeMap) {
            if (owningStruct !== lookupName) continue;
            const ownedType = ownedTypeLookup.get(ownedName);
            if (!ownedType) continue;
            const shortName = shortTypeName(ownedName, lookupName);
            if (ownedType.kind === 'enum') {
                emitStringEnum(writer, shortName, ownedType.cases, ownedType.description);
            } else if (ownedType.kind === 'struct') {
                emitStruct(writer, { ...ownedType, name: shortName }, ownedTypeMap, ownedTypeLookup, ownedName);
            } else if (ownedType.kind === 'discriminated-enum') {
                emitDiscriminatedEnum(writer, { ...ownedType, name: shortName });
            }
        }
        for (const field of type.fields) {
            writer.docComment(field.description);
            if (field.deprecated) {
                writer.line(deprecatedAttribute(field.deprecationMessage));
            }
            writer.line(`public let ${escapeKeyword(field.name)}: ${resolveFieldType(field.type, field.optional)}`);
        }
        if (needsCodingKeys) {
            writer.blank();
            writer.block('private enum CodingKeys: String, CodingKey', () => {
                for (const field of type.fields) {
                    if (field.name === field.wireName) {
                        writer.line(`case ${escapeKeyword(field.name)}`);
                    } else {
                        writer.line(`case ${escapeKeyword(field.name)} = ${stringLiteral(field.wireName)}`);
                    }
                }
            });
        }
        writer.blank();
        emitMemberwiseInit(writer, adjustedFields);
    });
};

const emitDiscriminatedEnum = (writer: SwiftWriter, type: Extract<SwiftType, { kind: 'discriminated-enum' }>): void => {
    writer.block(`public enum ${type.name}: Codable, Sendable, Equatable`, () => {
        for (const variant of type.variants) {
            writer.line(`case ${escapeKeyword(variant.caseName)}(${variant.payloadType})`);
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
            if (type.name.startsWith(operationName)) {
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

const localTypeName = (fullName: string, operationName: string): string => {
    const stripped = fullName.slice(operationName.length);
    return stripped || fullName;
};

const SWIFT_PRIMITIVE_TYPES = new Set(['String', 'Int', 'Double', 'Bool', 'Date', 'Void']);

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
        const qualified = `${clientName}.AnyCodable`;
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
        writer.line(`public let body: ${bodyType}`);
        if (method.resultHeaderFields.length > 0) {
            writer.line('public let headers: Headers');
            writer.blank();
            writer.block('public struct Headers: Sendable', () => {
                for (const field of method.resultHeaderFields) {
                    const rawType = resolveType(field.type, method.operationName, context, 'operation-enum');
                    writer.line(`public let ${escapeKeyword(field.name)}: ${optionalize(rawType, field.optional)}`);
                }
            });
        }
    });
};

const emitFailureEnum = (writer: SwiftWriter, method: RouteMethod, context: EmitContext): void => {
    writer.blank();
    const hasDecodedResponse = method.successReturnType !== 'Void' || method.errorCases.some((c) => c.type !== 'Void');
    writer.block('public enum Failure: Swift.Error, Sendable', () => {
        writer.line('case requestFailed(Swift.Error)');
        writer.line('case cancelled');
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

const emitKizunaNamespace = (writer: SwiftWriter, options: { multipart: boolean; clientName: string }): void => {
    writer.blank();
    writer.block('private enum Kizuna', () => {
        writer.line('nonisolated(unsafe) static let iso8601Formatter: ISO8601DateFormatter = {');
        writer.line('    let formatter = ISO8601DateFormatter()');
        writer.line('    formatter.formatOptions = [.withInternetDateTime]');
        writer.line('    return formatter');
        writer.line('}()');
        writer.blank();
        writer.line('nonisolated(unsafe) static let iso8601FractionalFormatter: ISO8601DateFormatter = {');
        writer.line('    let formatter = ISO8601DateFormatter()');
        writer.line('    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]');
        writer.line('    return formatter');
        writer.line('}()');
        writer.blank();
        writer.block('@Sendable static func decodeDate(_ decoder: Decoder) throws -> Date', () => {
            writer.line('let container = try decoder.singleValueContainer()');
            writer.line('let raw = try container.decode(String.self)');
            writer.line('if let date = iso8601FractionalFormatter.date(from: raw) { return date }');
            writer.line('if let date = iso8601Formatter.date(from: raw) { return date }');
            writer.line('throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid ISO8601 date: \\(raw)")');
        });
        writer.blank();
        writer.block('static func makeJSONEncoder() -> JSONEncoder', () => {
            writer.line('let encoder = JSONEncoder()');
            writer.line('encoder.dateEncodingStrategy = .custom { date, encoder in');
            writer.line('    var container = encoder.singleValueContainer()');
            writer.line('    try container.encode(iso8601FractionalFormatter.string(from: date))');
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
        writer.block('static func encodePathSegment(_ value: String) -> String', () => {
            writer.line('value.addingPercentEncoding(withAllowedCharacters: pathSegmentAllowed) ?? value');
        });
        writer.blank();
        writer.block('static func appendPath(_ base: URL, _ path: String) -> URL', () => {
            writer.line('base.appending(path: path, directoryHint: .notDirectory)');
        });
        writer.blank();
        writer.block('static func stringifyQueryValue(_ value: Any) -> [String]', () => {
            writer.line('switch value {');
            writer.line('case let date as Date:');
            writer.line('    return [iso8601Formatter.string(from: date)]');
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

const buildMethodParameters = (method: RouteMethod, context: EmitContext): string[] => {
    const params: string[] = [];
    for (const pathParam of method.pathParams) {
        params.push(`${escapeKeyword(pathParam)}: String`);
    }
    if (method.body) {
        if (method.body.kind === 'json-flat' || method.body.kind === 'multipart') {
            for (const field of method.body.flattened) {
                const rawType =
                    field.type === 'MultipartFile'
                        ? `${context.clientName}.MultipartFile`
                        : resolveType(field.type, method.operationName, context);
                const typeExpression = optionalize(rawType, field.optional);
                const defaultPart = field.optional ? ' = nil' : '';
                params.push(`${escapeKeyword(field.name)}: ${typeExpression}${defaultPart}`);
            }
        } else if (method.body.kind === 'json-struct' && method.body.structName) {
            const resolved = resolveType(method.body.structName, method.operationName, context);
            params.push(`_ input: ${resolved}`);
        } else if (method.body.kind === 'union' && method.body.structName) {
            const resolved = resolveType(method.body.structName, method.operationName, context);
            params.push(`_ input: ${resolved}`);
        }
    }
    for (const field of method.query) {
        const typeExpression = optionalize(resolveType(field.type, method.operationName, context), field.optional);
        const defaultPart = field.optional ? ' = nil' : '';
        params.push(`${escapeKeyword(field.name)}: ${typeExpression}${defaultPart}`);
    }
    for (const field of method.headers) {
        const typeExpression = optionalize(resolveType(field.type, method.operationName, context), field.optional);
        const defaultPart = field.optional ? ' = nil' : '';
        params.push(`${escapeKeyword(field.name)}Header: ${typeExpression}${defaultPart}`);
    }
    return params;
};

const deprecatedAttribute = (message: string | undefined): string => {
    if (message === undefined || message === '') return '@available(*, deprecated)';
    return `@available(*, deprecated, message: ${stringLiteral(message)})`;
};

const failureRef = (method: RouteMethod, context: EmitContext): string =>
    `${context.clientName}.${method.operationName}.${method.failureEnumName}`;

const emitMethodBody = (writer: SwiftWriter, method: RouteMethod, context: EmitContext): void => {
    const failure = failureRef(method, context);
    const pathDecl = method.pathParams.length > 0 ? 'var' : 'let';
    const componentsDecl = method.query.length > 0 ? 'var' : 'let';
    writer.line(`${pathDecl} path = ${stringLiteral(method.pathTemplate)}`);
    for (const pathParam of method.pathParams) {
        writer.line(
            `path = path.replacingOccurrences(of: ${stringLiteral(`:${pathParam}`)}, with: Kizuna.encodePathSegment(${escapeKeyword(pathParam)}))`
        );
    }

    writer.line(
        `guard ${componentsDecl} components = URLComponents(url: Kizuna.appendPath(baseURL, path), resolvingAgainstBaseURL: false) else {`
    );
    writer.line(`    throw ${failure}.unexpectedStatus(-1, Data())`);
    writer.line('}');

    if (method.query.length > 0) {
        writer.line('var queryItems: [URLQueryItem] = []');
        for (const field of method.query) {
            const appendBlock = (sourceExpression: string): void => {
                writer.block(`for stringValue in Kizuna.stringifyQueryValue(${sourceExpression})`, () => {
                    writer.line(`queryItems.append(URLQueryItem(name: ${stringLiteral(field.wireName)}, value: stringValue))`);
                });
            };
            if (field.optional) {
                writer.block(`if let value = ${escapeKeyword(field.name)}`, () => {
                    appendBlock('value');
                });
            } else {
                appendBlock(escapeKeyword(field.name));
            }
        }
        writer.line('if !queryItems.isEmpty { components.queryItems = queryItems }');
    }

    writer.line(`guard let url = components.url else { throw ${failure}.unexpectedStatus(-1, Data()) }`);
    writer.line('var request = URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: timeout)');
    writer.line(`request.httpMethod = ${stringLiteral(method.method)}`);

    if (method.body) {
        emitBodyEncoding(writer, method, context);
    }

    for (const field of method.headers) {
        const headerParam = `${escapeKeyword(field.name)}Header`;
        const setHeader = (sourceExpression: string): void => {
            writer.line(
                `request.setValue(Kizuna.stringifyQueryValue(${sourceExpression}).joined(separator: ", "), forHTTPHeaderField: ${stringLiteral(field.wireName)})`
            );
        };
        if (field.optional) {
            writer.block(`if let value = ${headerParam}`, () => {
                setHeader('value');
            });
        } else {
            setHeader(headerParam);
        }
    }

    writer.line('if let middleware = requestMiddleware {');
    writer.line('    do { try await middleware(&request) }');
    writer.line(`    catch is CancellationError { throw ${failure}.cancelled }`);
    writer.line(`    catch { throw ${failure}.requestFailed(error) }`);
    writer.line('}');

    writer.line('let data: Foundation.Data');
    writer.line('let response: URLResponse');
    writer.line('do {');
    writer.line('    (data, response) = try await session.data(for: request)');
    writer.line(`} catch is CancellationError { throw ${failure}.cancelled }`);
    writer.line(`catch { throw ${failure}.requestFailed(error) }`);
    writer.line('if let middleware = responseMiddleware {');
    writer.line('    await middleware(request, data, response)');
    writer.line('}');
    if (method.resultHeaderFields.length > 0) {
        writer.line('let httpResponse = response as? HTTPURLResponse');
        writer.line('let statusCode = httpResponse?.statusCode ?? -1');
    } else {
        writer.line('let statusCode = (response as? HTTPURLResponse)?.statusCode ?? -1');
    }

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
                            `    let ${escapeKeyword(field.name)} = httpResponse?.value(forHTTPHeaderField: ${stringLiteral(field.wireName)})`
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
                    writer.line('    do {');
                    writer.line(`        let payload = try decoder.decode(${resolved}.self, from: data)`);
                    for (const field of successResponse.responseHeaders) {
                        writer.line(
                            `        let ${escapeKeyword(field.name)} = httpResponse?.value(forHTTPHeaderField: ${stringLiteral(field.wireName)})`
                        );
                    }
                    if (hasHeaders) {
                        writer.line(
                            `        return ${qualifiedResult}(body: .status${successResponse.status}(payload), headers: .init(${headersInitArgs}))`
                        );
                    } else {
                        writer.line(`        return ${qualifiedResult}(body: .status${successResponse.status}(payload))`);
                    }
                    writer.line('    } catch {');
                    writer.line(`        throw ${failure}.decoding(error, statusCode: statusCode, data: data)`);
                    writer.line('    }');
                }
            } else {
                const resolved = resolveType(successResponse.type, method.operationName, context);
                writer.line('    do {');
                writer.line(`        let body = try decoder.decode(${resolved}.self, from: data)`);
                for (const field of successResponse.responseHeaders) {
                    writer.line(
                        `        let ${escapeKeyword(field.name)} = httpResponse?.value(forHTTPHeaderField: ${stringLiteral(field.wireName)})`
                    );
                }
                if (hasHeaders) {
                    writer.line(`        return ${qualifiedResult}(body: body, headers: .init(${headersInitArgs}))`);
                } else {
                    writer.line(`        return ${qualifiedResult}(body: body)`);
                }
                writer.line('    } catch {');
                writer.line(`        throw ${failure}.decoding(error, statusCode: statusCode, data: data)`);
                writer.line('    }');
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
                writer.line('    do {');
                writer.line(`        let payload = try decoder.decode(${resolved}.self, from: data)`);
                writer.line(`        throw ${failure}.${escapeKeyword(firstCase.caseName)}(payload)`);
                writer.line(`    } catch let error as ${failure} {`);
                writer.line('        throw error');
                writer.line('    } catch {');
                writer.line(`        throw ${failure}.decoding(error, statusCode: statusCode, data: data)`);
                writer.line('    }');
            }
        } else {
            for (const errorCase of cases) {
                if (errorCase.type === 'Void') {
                    writer.line(`    throw ${failure}.${escapeKeyword(errorCase.caseName)}`);
                } else {
                    const resolved = resolveType(errorCase.type, method.operationName, context);
                    writer.line('    do {');
                    writer.line(`        let payload = try decoder.decode(${resolved}.self, from: data)`);
                    writer.line(`        throw ${failure}.${escapeKeyword(errorCase.caseName)}(payload)`);
                    writer.line(`    } catch let error as ${failure} {`);
                    writer.line('        throw error');
                    writer.line('    } catch {}');
                }
            }
            writer.line(
                `    throw ${failure}.decoding(DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "No matching type for status ${status}")), statusCode: statusCode, data: data)`
            );
        }
    }
    writer.line('default:');
    writer.line(`    throw ${failure}.unexpectedStatus(statusCode, data)`);
    writer.line('}');
};

const buildMethodSignature = (method: RouteMethod, context: EmitContext): string => {
    const { clientName } = context;
    const failure = failureRef(method, context);
    const params = buildMethodParameters(method, context);
    let successType: string;
    if (method.resultWrapperName) {
        successType = `${clientName}.${method.operationName}.${method.resultWrapperName}`;
    } else if (method.successReturnType === 'Void') {
        successType = 'Void';
    } else if (method.successSumEnumName) {
        successType = `${clientName}.${method.operationName}.Success`;
    } else {
        successType = resolveType(method.successReturnType, method.operationName, context);
    }
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
        const encoderSlot =
            method.body && (method.body.kind === 'json-flat' || method.body.kind === 'json-struct' || method.body.kind === 'union')
                ? 'encoder'
                : '_';
        const needsDecoder = method.successReturnType !== 'Void' || method.errorCases.some((c) => c.type !== 'Void');
        const decoderSlot = needsDecoder ? 'decoder' : '_';
        writer.line(
            `let (baseURL, session, ${encoderSlot}, ${decoderSlot}, requestMiddleware, responseMiddleware) = await _actor._kizunaContext()`
        );
        writer.line('let timeout = _actor.timeout');
        emitMethodBody(writer, method, context);
    });
};

const emitSubClientStruct = (writer: SwiftWriter, group: RouteGroup, actorName: string, context: EmitContext): void => {
    writer.blank();
    writer.block(`public struct ${group.structName}: Sendable`, () => {
        writer.line(`private let _actor: ${actorName}`);
        writer.blank();
        writer.block(`init(_actor: ${actorName})`, () => {
            writer.line('self._actor = _actor');
        });
        for (const method of group.methods) {
            writer.blank();
            emitSubClientMethod(writer, method, context);
        }
    });
};

const emitBodyEncoding = (writer: SwiftWriter, method: RouteMethod, context: EmitContext): void => {
    if (!method.body) return;
    const body = method.body;
    const failure = failureRef(method, context);

    if (body.kind === 'multipart') {
        writer.line('var multipart = Kizuna.MultipartBuilder()');
        for (const field of body.multipartFields) {
            const isFlattenedFile = body.flattened.find((flatField) => flatField.name === field.name)?.isFile === true;
            if (field.isFile || isFlattenedFile) {
                writer.line(`multipart.appendFile(name: ${stringLiteral(field.wireName)}, file: ${escapeKeyword(field.name)})`);
            } else {
                writer.line(
                    `multipart.appendField(name: ${stringLiteral(field.wireName)}, value: String(describing: ${escapeKeyword(field.name)}))`
                );
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
    if (body.kind === 'json-struct' || body.kind === 'union') {
        writer.line('do {');
        writer.line('    request.httpBody = try encoder.encode(input)');
        writer.line(`} catch { throw ${failure}.requestFailed(error) }`);
        return;
    }
    if (body.kind === 'json-flat' && body.structName) {
        const resolved = resolveType(body.structName, method.operationName, context);
        const args = body.flattened.map((field) => `${field.name}: ${escapeKeyword(field.name)}`).join(', ');
        writer.line(`let body = ${resolved}(${args})`);
        writer.line('do {');
        writer.line('    request.httpBody = try encoder.encode(body)');
        writer.line(`} catch { throw ${failure}.requestFailed(error) }`);
    }
};

const emitClient = (
    writer: SwiftWriter,
    config: { clientName: string; anyCodable: boolean },
    partition: ContractPartition,
    context: EmitContext,
    typesByOperation: Map<string, SwiftType[]>
): void => {
    const { clientName } = config;
    const { flatMethods, groups } = partition;
    const allMethods = [...flatMethods, ...groups.flatMap((group) => group.methods)];

    const usesMultipart = allMethods.some((method) => method.body?.kind === 'multipart');

    writer.blank();
    writer.block(`public actor ${clientName}`, () => {
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
            writer.block('public struct AnyCodable: Codable, Sendable, Equatable', () => {
                writer.line('public let value: Foundation.Data?');
                writer.line('public init(value: Foundation.Data? = nil) { self.value = value }');
                writer.block('public init(from decoder: Decoder) throws', () => {
                    writer.line('let container = try decoder.singleValueContainer()');
                    writer.line('if container.decodeNil() { self.value = nil; return }');
                    writer.line(
                        'let raw = try JSONSerialization.data(withJSONObject: try container.decode(CodableValue.self).rawValue, options: [])'
                    );
                    writer.line('self.value = raw');
                });
                writer.block('public func encode(to encoder: Encoder) throws', () => {
                    writer.line('var container = encoder.singleValueContainer()');
                    writer.line('if let value = value, let object = try? JSONSerialization.jsonObject(with: value) {');
                    writer.line('    try container.encode(CodableValue(rawValue: object))');
                    writer.line('} else {');
                    writer.line('    try container.encodeNil()');
                    writer.line('}');
                });
                writer.line('public static func == (lhs: AnyCodable, rhs: AnyCodable) -> Bool { lhs.value == rhs.value }');
                writer.blank();
                writer.block('private struct CodableValue: Codable', () => {
                    writer.line('let rawValue: Any');
                    writer.line('init(rawValue: Any) { self.rawValue = rawValue }');
                    writer.block('init(from decoder: Decoder) throws', () => {
                        writer.line('let container = try decoder.singleValueContainer()');
                        writer.line('if container.decodeNil() { self.rawValue = NSNull(); return }');
                        writer.line('if let value = try? container.decode(Bool.self) { self.rawValue = value; return }');
                        writer.line('if let value = try? container.decode(Int.self) { self.rawValue = value; return }');
                        writer.line('if let value = try? container.decode(Double.self) { self.rawValue = value; return }');
                        writer.line('if let value = try? container.decode(String.self) { self.rawValue = value; return }');
                        writer.line(
                            'if let value = try? container.decode([CodableValue].self) { self.rawValue = value.map(\\.rawValue); return }'
                        );
                        writer.line(
                            'if let value = try? container.decode([String: CodableValue].self) { self.rawValue = value.mapValues(\\.rawValue); return }'
                        );
                        writer.line('self.rawValue = NSNull()');
                    });
                    writer.block('func encode(to encoder: Encoder) throws', () => {
                        writer.line('var container = encoder.singleValueContainer()');
                        writer.line('switch rawValue {');
                        writer.line('case is NSNull: try container.encodeNil()');
                        writer.line('case let value as Bool: try container.encode(value)');
                        writer.line('case let value as Int: try container.encode(value)');
                        writer.line('case let value as Double: try container.encode(value)');
                        writer.line('case let value as String: try container.encode(value)');
                        writer.line('case let value as [Any]: try container.encode(value.map(CodableValue.init(rawValue:)))');
                        writer.line('case let value as [String: Any]: try container.encode(value.mapValues(CodableValue.init(rawValue:)))');
                        writer.line('default: try container.encodeNil()');
                        writer.line('}');
                    });
                });
            });
        }
        writer.line('public let baseURL: URL');
        writer.line('public let session: URLSession');
        writer.line('public nonisolated let timeout: TimeInterval');
        writer.line('public var requestMiddleware: (@Sendable (inout URLRequest) async throws -> Void)?');
        writer.line('public var responseMiddleware: (@Sendable (URLRequest, Foundation.Data, URLResponse) async -> Void)?');
        writer.line('private let encoder: JSONEncoder');
        writer.line('private let decoder: JSONDecoder');
        writer.blank();
        writer.block(
            'public init(baseURL: URL, session: URLSession = .shared, timeout: TimeInterval = 30, requestMiddleware: (@Sendable (inout URLRequest) async throws -> Void)? = nil, responseMiddleware: (@Sendable (URLRequest, Foundation.Data, URLResponse) async -> Void)? = nil)',
            () => {
                writer.line('self.baseURL = baseURL');
                writer.line('self.session = session');
                writer.line('self.timeout = timeout');
                writer.line('self.requestMiddleware = requestMiddleware');
                writer.line('self.responseMiddleware = responseMiddleware');
                writer.line('self.encoder = Kizuna.makeJSONEncoder()');
                writer.line('self.decoder = Kizuna.makeJSONDecoder()');
            }
        );

        if (groups.length > 0) {
            writer.blank();
            writer.block(
                'func _kizunaContext() -> (URL, URLSession, JSONEncoder, JSONDecoder, (@Sendable (inout URLRequest) async throws -> Void)?, (@Sendable (URLRequest, Foundation.Data, URLResponse) async -> Void)?)',
                () => {
                    writer.line('return (baseURL, session, encoder, decoder, requestMiddleware, responseMiddleware)');
                }
            );

            for (const group of groups) {
                writer.blank();
                writer.block(`public var ${escapeKeyword(group.propertyName)}: ${group.structName}`, () => {
                    writer.line(`${group.structName}(_actor: self)`);
                });
            }
        }

        for (const method of allMethods) {
            const localTypes = (typesByOperation.get(method.operationName) ?? []).map((type) =>
                localizeType(type, method.operationName, context)
            );
            writer.blank();
            writer.block(`public enum ${method.operationName}`, () => {
                emitTypes(writer, localTypes);
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
 * Generate a Swift API client from a ts-kizuna contract.
 *
 * @param contract - The router from `createContract({ ... })`.
 * @param config - Override the generated names:
 *   - `clientName` — the actor class. Defaults to `APIClient`.
 */
export const generateSwiftClient = (contract: Contract, config: SwiftConfig): string => {
    const { namespaceName, deprecationWarnings } = config;

    const registry = new TypeRegistry();
    const partition = swiftGenerator(contract, {
        namespaceName,
        deprecationWarnings,
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
            if (type.name.startsWith(structName) && (!bestMatch || structName.length > bestMatch.length)) {
                bestMatch = structName;
            }
        }
        if (bestMatch !== undefined) ownedTypeMap.set(type.name, bestMatch);
    }
    const ownedTypeLookup = new Map(sharedTypes.filter((type) => ownedTypeMap.has(type.name)).map((type) => [type.name, type]));
    const topLevelSharedTypes = sharedTypes.filter((type) => !ownedTypeMap.has(type.name));

    const context: EmitContext = {
        namespaceName,
        clientName,
        operationTypeMap,
        fileLevelTypeNames,
        ownedTypeMap,
    };

    writer.block(`public enum ${namespaceName}`, () => {
        emitTypes(writer, topLevelSharedTypes, ownedTypeMap, ownedTypeLookup);
    });

    emitClient(writer, { clientName, anyCodable: registry.usesAnyCodable }, partition, context, typesByOperation);

    for (const group of partition.groups) {
        emitSubClientStruct(writer, group, clientName, context);
    }

    emitKizunaNamespace(writer, {
        multipart: usesMultipart,
        clientName,
    });

    for (const warning of registry.warnings()) {
        process.stderr.write(`[ts-kizuna/swift] AnyCodable fallback at ${warning}\n`);
    }

    return writer.toString();
};
