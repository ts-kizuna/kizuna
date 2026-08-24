import { z } from 'zod';
import { stringify as stringifyYaml } from 'yaml';
import {
    createGenerator,
    isFileSchema,
    isBinarySchema,
    isVoidSchema,
    parsePath,
    readDiscriminatedUnion,
    readDiscriminatorLiteral,
    readMeta,
    readMetaId,
    readObjectShape,
    globalRegistrySchemas,
    resolveResponseBody,
    resolveResponseHeaders,
    resolveResponseContentType,
    deprecationHeaders,
} from '@ts-kizuna/core/generator';
import { getStatusText } from '@ts-kizuna/core';
import type { Contract, SecurityRequirement } from '@ts-kizuna/core';
import { OPENAPI_PLUGIN_NAME } from './plugin.js';
import type {
    GenerateOpenApiOptions,
    OpenApiDocument,
    OpenApiOperation,
    OpenApiParameter,
    OpenApiRenderer,
    OpenApiResponseObject,
    OpenApiTag,
} from './types.js';

const convertPath = (path: string): string => {
    const { segments } = parsePath(path);
    return segments.map((segment) => (segment.kind === 'literal' ? segment.value : `{${segment.value}}`)).join('');
};

const COMPONENT_REF_BASE = '#/components/schemas/';
const ZOD_DEF_REF_BASE = '#/$defs/';

const omit = (input: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
        if (!keys.includes(key)) result[key] = value;
    }
    return result;
};

const rewriteRefs = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewriteRefs);
    if (value && typeof value === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
            if (key === '$ref' && typeof child === 'string' && child.startsWith(ZOD_DEF_REF_BASE)) {
                result[key] = COMPONENT_REF_BASE + child.slice(ZOD_DEF_REF_BASE.length);
            } else {
                result[key] = rewriteRefs(child);
            }
        }
        return result;
    }
    return value;
};

const applyFileBinary = (zodSchema: z.core.$ZodType, jsonSchema: unknown): void => {
    if (!jsonSchema || typeof jsonSchema !== 'object') return;
    const shape = readObjectShape(zodSchema);
    if (!shape) return;
    const properties = (jsonSchema as { properties?: Record<string, unknown> }).properties;
    if (!properties) return;
    for (const [key, child] of Object.entries(shape)) {
        if (isFileSchema(child)) {
            properties[key] = {
                type: 'string',
                format: 'binary',
            };
        } else {
            applyFileBinary(child, properties[key]);
        }
    }
};

const buildDiscriminatorBlock = (
    propertyName: string,
    options: z.core.$ZodType[]
): { propertyName: string; mapping?: Record<string, string> } => {
    const mapping: Record<string, string> = {};
    let mappingComplete = true;
    for (const variant of options) {
        const variantId = readMetaId(variant);
        const literal = readDiscriminatorLiteral(variant, propertyName);
        if (variantId === undefined || literal === undefined) {
            mappingComplete = false;
            break;
        }
        mapping[String(literal)] = COMPONENT_REF_BASE + variantId;
    }
    return mappingComplete && Object.keys(mapping).length > 0
        ? {
              propertyName,
              mapping,
          }
        : {
              propertyName,
          };
};

/**
 * kizuna's metadata widens JSON Schema: `deprecated` may carry a message and
 * `example` holds one value or several. Emit `deprecated: true` and an
 * `examples` array; the message stays in outputs with a place for it, like
 * Swift's `@available`.
 */
const normalizeMeta = ({ jsonSchema }: { jsonSchema: Record<string, unknown> }): void => {
    if (typeof jsonSchema.deprecated === 'string') jsonSchema.deprecated = true;
    if ('example' in jsonSchema) {
        const given = Array.isArray(jsonSchema.example) ? jsonSchema.example : [jsonSchema.example];
        const declared = Array.isArray(jsonSchema.examples) ? jsonSchema.examples : [];
        jsonSchema.examples = [...given, ...declared];
        delete jsonSchema.example;
    }
};

const toJsonSchema = (schema: z.ZodType, io: 'input' | 'output' = 'output'): Record<string, unknown> => {
    const id = readMetaId(schema);
    if (id) {
        return {
            $ref: COMPONENT_REF_BASE + id,
        };
    }
    const discriminated = readDiscriminatedUnion(schema);
    if (discriminated) {
        const raw = rewriteRefs(
            omit(z.toJSONSchema(schema, { unrepresentable: 'any', io, override: normalizeMeta }) as Record<string, unknown>, [
                '$defs',
                '$schema',
            ])
        ) as Record<string, unknown>;
        return {
            ...raw,
            discriminator: buildDiscriminatorBlock(discriminated.discriminator, discriminated.options),
        };
    }
    const raw = z.toJSONSchema(schema, { unrepresentable: 'any', io, override: normalizeMeta }) as Record<string, unknown>;
    const result = rewriteRefs(omit(raw, ['$defs', '$schema'])) as Record<string, unknown>;
    applyFileBinary(schema, result);
    return result;
};

const buildComponentSchemas = (): Record<string, unknown> | undefined => {
    const discriminators = new Map<string, { propertyName: string; mapping?: Record<string, string> }>();
    const modelRegistry = z.registry<z.core.GlobalMeta>();
    for (const [id, schema] of globalRegistrySchemas().entries()) {
        modelRegistry.add(schema as z.ZodType, readMeta(schema) as z.core.GlobalMeta);
        const def = readDiscriminatedUnion(schema);
        if (def) {
            discriminators.set(id, buildDiscriminatorBlock(def.discriminator, def.options));
        }
    }

    const result = z.toJSONSchema(modelRegistry, {
        uri: (id: string) => COMPONENT_REF_BASE + id,
        unrepresentable: 'any',
        io: 'output',
        override: normalizeMeta,
    });
    const schemas = result.schemas as Record<string, Record<string, unknown>>;
    const cleaned: Record<string, unknown> = {};
    for (const [id, schema] of Object.entries(schemas)) {
        const base = rewriteRefs(omit(schema, ['$schema', '$defs', '$id'])) as Record<string, unknown>;
        const discriminator = discriminators.get(id);
        cleaned[id] = discriminator
            ? {
                  ...base,
                  discriminator,
              }
            : base;
    }
    return Object.keys(cleaned).length > 0 ? cleaned : undefined;
};

/**
 * Internal generator options: the public options plus, per group path, the tag
 * names an operation in that group is filed under.
 */
type GeneratorContext = GenerateOpenApiOptions & {
    groupTitles?: ReadonlyMap<string, readonly string[]>;
};

const deriveHeadOperation = (getOperation: OpenApiOperation): OpenApiOperation => {
    const operation = structuredClone(getOperation);
    delete operation.operationId;
    for (const response of Object.values(operation.responses)) {
        delete response.content;
    }
    return operation;
};

const openApiGenerator = createGenerator((options: GeneratorContext, contract: Contract) => {
    const paths: Record<string, Record<string, OpenApiOperation>> = {};

    return {
        processRoute({ routeKey, route, routeTags, deprecated }) {
            const openApiPath = convertPath(route.path);
            const method = route.method.toLowerCase();

            let operation: OpenApiOperation = {
                summary: route.summary,
                description: route.description,
                responses: {},
            };

            if (options.setOperationId) {
                operation.operationId =
                    options.setOperationId === 'concatenated-path' ? routeKey : routeKey.slice(routeKey.lastIndexOf('.') + 1);
            }
            if (deprecated) operation.deprecated = true;
            const filedUnder = (path: string): readonly string[] => options.groupTitles?.get(path) ?? [path];
            const mergedTags = [...new Set([...routeTags, ...(route.groups ?? [])].flatMap(filedUnder))];
            if (mergedTags.length > 0) {
                operation.tags = mergedTags;
            }
            if (route.security && route.security.length > 0) {
                const emittedSecurity = toOpenApiSecurity(route.security, contract);
                if (emittedSecurity.length > 0) operation.security = emittedSecurity;
                const customGuards = customGuardsFor(route.security, contract);
                if (customGuards.length > 0) operation['x-kizuna-guarded'] = customGuards;
            }
            if (route.externalDocs) operation.externalDocs = route.externalDocs;

            const parameters: OpenApiParameter[] = [];

            const pathParamNames = parsePath(route.path).paramNames;
            if (pathParamNames.length > 0) {
                const pathParamsSchema = route.pathParams ? toJsonSchema(route.pathParams, 'input') : undefined;
                const pathProperties = (pathParamsSchema?.properties ?? {}) as Record<string, Record<string, unknown>>;
                for (const name of pathParamNames) {
                    parameters.push({
                        name,
                        in: 'path',
                        required: true,
                        schema: pathProperties[name] ?? { type: 'string' },
                    });
                }
            }

            if (route.query) {
                const querySchema = toJsonSchema(route.query, 'input');
                const queryProperties = (querySchema.properties ?? {}) as Record<string, Record<string, unknown>>;
                const queryRequired = (querySchema.required ?? []) as string[];
                for (const [name, valueSchema] of Object.entries(queryProperties)) {
                    parameters.push({
                        name,
                        in: 'query',
                        required: queryRequired.includes(name),
                        schema: valueSchema,
                    });
                }
            }

            if (route.headers) {
                const headersSchema = toJsonSchema(route.headers, 'input');
                const headerProperties = (headersSchema.properties ?? {}) as Record<string, Record<string, unknown>>;
                const headerRequired = (headersSchema.required ?? []) as string[];
                for (const [name, valueSchema] of Object.entries(headerProperties)) {
                    parameters.push({
                        name,
                        in: 'header',
                        required: headerRequired.includes(name),
                        schema: valueSchema,
                    });
                }
            }

            if (parameters.length > 0) operation.parameters = parameters;

            if (route.body && !isVoidSchema(route.body)) {
                const contentType = route.contentType ?? 'application/json';
                operation.requestBody = {
                    required: true,
                    content: {
                        [contentType]: {
                            schema: toJsonSchema(route.body, 'input'),
                        },
                    },
                };
            }

            for (const [statusKey, responseValue] of Object.entries(route.responses)) {
                const bodySchema = resolveResponseBody(responseValue);
                const headersSchema = resolveResponseHeaders(responseValue);
                const description = getStatusText(Number(statusKey));
                const headersObject: OpenApiResponseObject['headers'] = headersSchema
                    ? Object.fromEntries(
                          Object.entries(
                              (toJsonSchema(headersSchema, 'output') as { properties?: Record<string, Record<string, unknown>> })
                                  .properties ?? {}
                          ).map(([name, schema]) => [name, { schema, required: false }])
                      )
                    : undefined;
                const mediaType =
                    resolveResponseContentType(responseValue) ??
                    (Number(statusKey) >= 400 ? 'application/problem+json' : 'application/json');
                operation.responses[statusKey] = {
                    description,
                    ...(headersObject ? { headers: headersObject } : {}),
                    ...(!isVoidSchema(bodySchema) && route.method !== 'HEAD'
                        ? {
                              content: {
                                  [mediaType]: {
                                      schema: isBinarySchema(bodySchema)
                                          ? { type: 'string', format: 'binary' }
                                          : toJsonSchema(bodySchema, 'output'),
                                  },
                              },
                          }
                        : {}),
                };
            }

            const hasValidation = route.body || route.query;
            if (hasValidation) {
                const validationSchema = {
                    type: 'object',
                    required: ['type', 'title', 'status', 'detail', 'errors'],
                    properties: {
                        type: { type: 'string' },
                        title: { type: 'string' },
                        status: { type: 'integer' },
                        detail: { type: 'string' },
                        errors: {
                            type: 'array',
                            items: {
                                type: 'object',
                                required: ['code', 'path', 'message'],
                                properties: {
                                    code: { type: 'string' },
                                    path: {
                                        type: 'array',
                                        items: { type: 'string' },
                                    },
                                    message: { type: 'string' },
                                },
                            },
                        },
                    },
                };
                const existing = operation.responses['400'];
                if (existing) {
                    const existingSchema = existing.content?.['application/problem+json']?.schema;
                    operation.responses['400'] = {
                        description: getStatusText(400),
                        content: {
                            'application/problem+json': {
                                schema: {
                                    oneOf: [existingSchema, validationSchema].filter(Boolean),
                                },
                            },
                        },
                    };
                } else {
                    operation.responses['400'] = {
                        description: getStatusText(400),
                        content: {
                            'application/problem+json': {
                                schema: validationSchema,
                            },
                        },
                    };
                }
            }

            const announced = deprecationHeaders(route);
            if (Object.keys(announced).length > 0) {
                const documented: Record<string, { description: string; schema: Record<string, unknown> }> = {};
                if (announced['deprecation']) {
                    documented['Deprecation'] = {
                        description: 'The date the route became deprecated, per RFC 9745.',
                        schema: { type: 'string' },
                    };
                }
                if (announced['sunset']) {
                    documented['Sunset'] = {
                        description: 'When the route will be removed, per RFC 8594.',
                        schema: { type: 'string' },
                    };
                }
                if (announced['link']) {
                    documented['Link'] = {
                        description: 'Links to documentation about the deprecation and the retirement policy.',
                        schema: { type: 'string' },
                    };
                }
                for (const response of Object.values(operation.responses)) {
                    response.headers = {
                        ...documented,
                        ...response.headers,
                    };
                }
            }

            if (options.operationMapper) {
                operation = options.operationMapper(operation, route, routeKey);
            }

            if (!paths[openApiPath]) paths[openApiPath] = {};
            paths[openApiPath][method] = operation;
        },

        finalize() {
            if (options.derivedHead) {
                for (const operations of Object.values(paths)) {
                    if (!operations['get'] || operations['head']) continue;
                    operations['head'] = deriveHeadOperation(operations['get']);
                }
            }

            const document: OpenApiDocument = {
                openapi: options.openApiVersion ?? '3.1.0',
                info: options.info,
                paths,
            };

            if (options.servers) document.servers = options.servers;
            if (options.externalDocs) document.externalDocs = options.externalDocs;

            const componentSchemas = buildComponentSchemas();
            const securitySchemes = buildSecuritySchemes(contract);
            if (componentSchemas || securitySchemes) {
                document.components = {
                    ...(securitySchemes ? { securitySchemes } : {}),
                    ...(componentSchemas ? { schemas: componentSchemas } : {}),
                };
            }

            const renderer = (format: 'json' | 'yaml'): OpenApiDocument | string => {
                if (format === 'yaml') return stringifyYaml(document);
                return document;
            };
            return renderer as OpenApiRenderer;
        },
    };
});

/**
 * Whether a scheme is a `custom` identity: registered, but with no OpenAPI scheme
 * to emit. Dropped from `security`, surfaced under `x-kizuna-guarded`.
 */
const isCustomScheme = (name: string, contract: Contract): boolean => {
    const scheme = contract.securitySchemes?.[name];
    return scheme !== undefined && scheme.openapi === undefined;
};

/**
 * Map a route's resolved `security` (scheme names / `{ scheme: scopes }` maps)
 * to the OpenAPI `operation.security` shape. Any `custom` scheme is dropped (see
 * {@link isCustomScheme}); a requirement object left empty is omitted.
 */
const toOpenApiSecurity = (security: readonly SecurityRequirement[], contract: Contract): Array<Record<string, string[]>> => {
    const emittedName = (name: string): string => contract.securitySchemes?.[name]?.scheme ?? name;
    const result: Array<Record<string, string[]>> = [];
    for (const entry of security) {
        if (typeof entry === 'string') {
            if (!isCustomScheme(entry, contract)) result.push({ [emittedName(entry)]: [] });
            continue;
        }
        const describable = Object.entries(entry).filter(([scheme]) => !isCustomScheme(scheme, contract));
        if (describable.length > 0) {
            result.push(Object.fromEntries(describable.map(([scheme, scopes]) => [emittedName(scheme), [...(scopes ?? [])]])));
        }
    }
    return result;
};

/**
 * The `custom` schemes guarding a route, in their registered names, for the
 * `x-kizuna-guarded` extension.
 */
const customGuardsFor = (security: readonly SecurityRequirement[], contract: Contract): string[] => {
    const emittedName = (name: string): string => contract.securitySchemes?.[name]?.scheme ?? name;
    const names: string[] = [];
    for (const entry of security) {
        const schemeNames = typeof entry === 'string' ? [entry] : Object.keys(entry);
        for (const name of schemeNames) {
            if (isCustomScheme(name, contract) && !names.includes(emittedName(name))) names.push(emittedName(name));
        }
    }
    return names;
};

/**
 * Build the `components.securitySchemes` object from the identities registered
 * on the contract. Each contributes its OpenAPI definition under its name.
 */
const buildSecuritySchemes = (contract: Contract): Record<string, unknown> | undefined => {
    const schemes = contract.securitySchemes;
    if (!schemes || Object.keys(schemes).length === 0) return undefined;
    const result: Record<string, unknown> = {};
    for (const [name, scheme] of Object.entries(schemes)) {
        // A `custom` identity has no OpenAPI scheme to emit.
        if (!scheme.openapi) continue;
        result[scheme.scheme ?? name] = scheme.openapi;
    }
    return Object.keys(result).length > 0 ? result : undefined;
};

/**
 * The tag names an operation gets for each group path.
 *
 * OpenAPI 3.1.0 has no way to nest a tag, so an operation names its whole
 * lineage and a reader finds it under every ancestor.
 */
const groupTitlesFor = (contract: Contract): ReadonlyMap<string, readonly string[]> => {
    const titles = new Map<string, readonly string[]>();
    const declared = contract.groups;
    if (!declared) return titles;
    const titleOf = (path: string): string => declared.groups[path]?.title ?? path;
    for (const [path, group] of declared.resolved) {
        titles.set(path, group.lineage.map(titleOf));
    }
    return titles;
};

/**
 * Document-level tag definitions from the contract's groups, outermost first.
 */
const tagsFromContract = (contract: Contract): OpenApiTag[] => {
    const declared = contract.groups;
    if (!declared) return [];
    const tags: OpenApiTag[] = [];
    for (const { options } of declared.resolved.values()) {
        const entry: OpenApiTag = { name: options.title };
        if (options.description) entry.description = options.description;
        if (options.externalDocs) entry.externalDocs = options.externalDocs;
        tags.push(entry);
    }
    return tags;
};

/**
 * So a build step does not restate the options and drift from what is served.
 */
const optionsFromInstalledPlugin = (contract: Contract): GenerateOpenApiOptions => {
    for (const declaration of Object.values(contract.plugins ?? {})) {
        if (declaration.name === OPENAPI_PLUGIN_NAME) return declaration.props as unknown as GenerateOpenApiOptions;
    }
    throw new Error(
        "generateOpenApi reads its options from the contract. Install `openApiPlugin` on `new Kizuna()` with the API's `info`."
    );
};

/**
 * Render from options held directly, for `openApiPluginServer`.
 */
export function renderOpenApi(contract: Contract, options: GenerateOpenApiOptions): OpenApiRenderer {
    const renderer = openApiGenerator(contract, {
        ...options,
        groupTitles: groupTitlesFor(contract),
    });
    const tags = tagsFromContract(contract);
    if (tags.length > 0) {
        (renderer('json') as OpenApiDocument).tags = tags;
    }
    return renderer;
}

/**
 * Generate an OpenAPI 3.1.0 document from a contract. Returns a renderer: call
 * it with `'json'` or `'yaml'`. Options come from the `openApiPlugin` installed
 * on the contract, so the document matches the one the server serves.
 *
 * Pass `overrides` for what only a build step knows, such as the public
 * `servers` list.
 */
export function generateOpenApi(contract: Contract, overrides?: Partial<GenerateOpenApiOptions>): OpenApiRenderer {
    const options = optionsFromInstalledPlugin(contract);
    return renderOpenApi(contract, overrides ? { ...options, ...overrides } : options);
}
