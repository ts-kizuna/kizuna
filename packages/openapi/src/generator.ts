import { z } from 'zod';
import { stringify as stringifyYaml } from 'yaml';
import {
    createGenerator,
    contractFingerprint,
    loadDeprecations,
    isFileSchema,
    isBinarySchema,
    isVoidSchema,
    parsePath,
    readDiscriminatedUnion,
    readDiscriminatorLiteral,
    readMetaId,
    readObjectShape,
    globalRegistrySchemas,
    resolveResponseBody,
    resolveResponseHeaders,
    resolveResponseContentType,
    type RouteDefinition,
} from '@ts-kizuna/core/generator';
import { type Contract, type TagOptions, getStatusText, PROBLEM_DETAILS_META } from '@ts-kizuna/core';

/**
 * The OpenAPI Specification version declared in the document's `openapi` field.
 */
export type OpenApiVersion = '3.1.0';

export interface OpenApiInfo {
    title: string;
    version: string;
    description?: string;
}

export interface OpenApiServer {
    url: string;
    description?: string;
}

export interface OpenApiParameter {
    name: string;
    in: 'path' | 'query' | 'header' | 'cookie';
    required?: boolean;
    description?: string;
    schema: Record<string, unknown>;
}

export interface OpenApiResponseObject {
    description: string;
    content?: Record<string, { schema: Record<string, unknown> }>;
}

export interface OpenApiExternalDocs {
    url: string;
    description?: string;
}

export interface OpenApiTag {
    name: string;
    description?: string;
    externalDocs?: OpenApiExternalDocs;
}

export interface OpenApiOperation {
    operationId?: string;
    summary?: string;
    description?: string;
    deprecated?: boolean;
    tags?: string[];
    security?: Array<Record<string, string[]>>;
    externalDocs?: OpenApiExternalDocs;
    parameters?: OpenApiParameter[];
    requestBody?: {
        required?: boolean;
        content: Record<string, { schema: Record<string, unknown> }>;
    };
    responses: Record<string, OpenApiResponseObject>;
}

export interface OpenApiDocument {
    openapi: string;
    info: OpenApiInfo;
    servers?: OpenApiServer[];
    paths: Record<string, Record<string, OpenApiOperation>>;
    tags?: OpenApiTag[];
    security?: Array<Record<string, string[]>>;
    externalDocs?: OpenApiExternalDocs;
    components?: {
        securitySchemes?: Record<string, unknown>;
        schemas?: Record<string, unknown>;
    };
}

export interface GenerateOpenApiOptions {
    /**
     * The OpenAPI Specification version to declare in the document's `openapi` field.
     *
     * Defaults to `'3.1.0'`.
     */
    openApiVersion?: OpenApiVersion;
    info: OpenApiInfo;
    servers?: OpenApiServer[];
    tags?: OpenApiTag[];
    security?: Array<Record<string, string[]>>;
    externalDocs?: OpenApiExternalDocs;
    components?: {
        securitySchemes?: Record<string, unknown>;
    };
    setOperationId?: boolean | 'concatenated-path';
    operationMapper?: (operation: OpenApiOperation, route: RouteDefinition, operationId: string) => OpenApiOperation;
}

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
            omit(z.toJSONSchema(schema, { unrepresentable: 'any', io }) as Record<string, unknown>, ['$defs', '$schema'])
        ) as Record<string, unknown>;
        return {
            ...raw,
            discriminator: buildDiscriminatorBlock(discriminated.discriminator, discriminated.options),
        };
    }
    const raw = z.toJSONSchema(schema, { unrepresentable: 'any', io }) as Record<string, unknown>;
    const result = rewriteRefs(omit(raw, ['$defs', '$schema'])) as Record<string, unknown>;
    applyFileBinary(schema, result);
    return result;
};

const buildComponentSchemas = (): Record<string, unknown> | undefined => {
    const discriminators = new Map<string, { propertyName: string; mapping?: Record<string, string> }>();
    for (const [id, schema] of globalRegistrySchemas().entries()) {
        const def = readDiscriminatedUnion(schema);
        if (def) {
            discriminators.set(id, buildDiscriminatorBlock(def.discriminator, def.options));
        }
    }

    const result = z.toJSONSchema(z.globalRegistry, {
        uri: (id: string) => COMPONENT_REF_BASE + id,
        unrepresentable: 'any',
        io: 'output',
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

const COMPONENT_REF_PREFIX = '#/components/schemas/';

const applyDeprecatedToSchema = (
    schema: Record<string, unknown> | undefined,
    pathRest: string[],
    components: Record<string, Record<string, unknown>> | undefined
): void => {
    if (!schema) return;
    if (pathRest.length === 0) {
        schema.deprecated = true;
        return;
    }
    if (typeof schema.$ref === 'string') {
        if (!components) return;
        const ref = schema.$ref;
        if (!ref.startsWith(COMPONENT_REF_PREFIX)) return;
        const id = ref.slice(COMPONENT_REF_PREFIX.length);
        const target = components[id];
        applyDeprecatedToSchema(target, pathRest, components);
        return;
    }
    const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
    if (!properties) return;
    const head = pathRest[0];
    const rest = pathRest.slice(1);
    if (head === undefined) return;
    applyDeprecatedToSchema(properties[head], rest, components);
};

const applyDeprecatedToOperation = (
    operation: OpenApiOperation,
    path: string,
    components: Record<string, Record<string, unknown>> | undefined
): void => {
    const segments = path.split('.');
    const head = segments[0];
    const rest = segments.slice(1);
    if (head === 'body') {
        const content = operation.requestBody?.content;
        if (!content) return;
        for (const entry of Object.values(content)) {
            applyDeprecatedToSchema(entry.schema, rest, components);
        }
        return;
    }
    if (head === 'query' || head === 'headers') {
        if (rest.length !== 1) return;
        const direction = head === 'query' ? 'query' : 'header';
        const target = operation.parameters?.find((parameter) => parameter.in === direction && parameter.name === rest[0]);
        if (target) target.schema.deprecated = true;
        return;
    }
    if (head === 'responses') {
        const status = rest[0];
        if (status === undefined) return;
        const responseRest = rest.slice(1);
        const response = operation.responses[status];
        const responseContent = response?.content?.['application/json'] ?? response?.content?.['application/problem+json'];
        if (!responseContent) return;
        applyDeprecatedToSchema(responseContent.schema, responseRest, components);
    }
};

export interface OpenApiRenderer {
    (format: 'json'): OpenApiDocument;
    (format: 'yaml'): string;
}

/**
 * Internal generator options: the public options plus a `key → TagOptions`
 * lookup built from the contract's tag set, used to resolve tag keys to titles.
 */
type GeneratorContext = GenerateOpenApiOptions & {
    tagLookup?: ReadonlyMap<string, TagOptions>;
};

const openApiGenerator = createGenerator((options: GeneratorContext, contract: Contract) => {
    const paths: Record<string, Record<string, OpenApiOperation>> = {};
    const pendingFieldDeprecations: Array<{ operation: OpenApiOperation; fieldDeprecations: Map<string, string> }> = [];
    const schemaDeprecations = loadDeprecations(contractFingerprint(contract))?.schemas;
    // When the contract opted out of Problem Details, handler-authored error responses are
    // plain JSON. Framework errors (e.g. the validation 400 below) still emit Problem Details.
    const errorContentType =
        (contract.routes as { [PROBLEM_DETAILS_META]?: boolean })[PROBLEM_DETAILS_META] === false
            ? 'application/json'
            : 'application/problem+json';

    return {
        processRoute({ routeKey, route, routeTags, deprecated, fieldDeprecations }) {
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
            const resolveTagTitle = (key: string): string => options.tagLookup?.get(key)?.title ?? key;
            const mergedTags = [...new Set([...routeTags, ...(route.tags ?? [])].map(resolveTagTitle))];
            if (mergedTags.length > 0) {
                operation.tags = mergedTags;
            }
            if (route.security && route.security.length > 0) operation.security = route.security;
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
                const headersObject: Record<string, unknown> | undefined = headersSchema
                    ? Object.fromEntries(
                          Object.entries(
                              (toJsonSchema(headersSchema, 'output') as { properties?: Record<string, unknown> }).properties ?? {}
                          ).map(([name, schema]) => [name, { schema, required: false }])
                      )
                    : undefined;
                const mediaType =
                    resolveResponseContentType(responseValue) ?? (Number(statusKey) >= 400 ? errorContentType : 'application/json');
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
                // The validation 400 is a framework error and always Problem Details, even when
                // the contract opted out. Preserve any handler-declared 400 (which may be plain
                // JSON in custom mode) under its own media type and merge the validation schema
                // into the `application/problem+json` entry.
                const existingContent = operation.responses['400']?.content ?? {};
                const existingProblem = existingContent['application/problem+json']?.schema;
                operation.responses['400'] = {
                    description: getStatusText(400),
                    content: {
                        ...existingContent,
                        'application/problem+json': {
                            schema: existingProblem ? { oneOf: [existingProblem, validationSchema] } : validationSchema,
                        },
                    },
                };
            }

            if (options.operationMapper) {
                operation = options.operationMapper(operation, route, routeKey);
            }

            if (fieldDeprecations && fieldDeprecations.size > 0) {
                pendingFieldDeprecations.push({
                    operation,
                    fieldDeprecations,
                });
            }

            if (!paths[openApiPath]) paths[openApiPath] = {};
            paths[openApiPath][method] = operation;
        },

        finalize() {
            const document: OpenApiDocument = {
                openapi: options.openApiVersion ?? '3.1.0',
                info: options.info,
                paths,
            };

            if (options.servers) document.servers = options.servers;
            if (options.tags) document.tags = options.tags;
            if (options.security) document.security = options.security;
            if (options.externalDocs) document.externalDocs = options.externalDocs;

            const componentSchemas = buildComponentSchemas();
            if (componentSchemas || options.components) {
                document.components = {
                    ...(options.components ?? {}),
                    ...(componentSchemas ? { schemas: componentSchemas } : {}),
                };
            }

            const componentSchemasForLookup = componentSchemas as Record<string, Record<string, unknown>> | undefined;
            for (const { operation, fieldDeprecations: deprecatedPaths } of pendingFieldDeprecations) {
                for (const fieldPath of deprecatedPaths.keys()) {
                    applyDeprecatedToOperation(operation, fieldPath, componentSchemasForLookup);
                }
            }

            if (schemaDeprecations && componentSchemasForLookup) {
                for (const [metaId, fields] of schemaDeprecations) {
                    const component = componentSchemasForLookup[metaId];
                    if (!component) continue;
                    for (const fieldPath of fields.keys()) {
                        applyDeprecatedToSchema(component, fieldPath.split('.'), componentSchemasForLookup);
                    }
                }
            }

            const renderer = (format: 'json' | 'yaml'): OpenApiDocument | string => {
                if (format === 'yaml') return stringifyYaml(document);
                return document;
            };
            return renderer as OpenApiRenderer;
        },
    };
});

const buildTagLookup = (contract: Contract): ReadonlyMap<string, TagOptions> => new Map(Object.entries(contract.tags?.tags ?? {}));

/**
 * Document-level tag definitions from the contract's declared tag set — one
 * entry per declared tag, in declaration order, named by its `title`.
 */
const tagsFromContract = (contract: Contract): OpenApiTag[] => {
    const declared = contract.tags?.tags;
    if (!declared) return [];
    const tags: OpenApiTag[] = [];
    for (const options of Object.values(declared)) {
        const entry: OpenApiTag = { name: options.title };
        if (options.description) entry.description = options.description;
        if (options.externalDocs) entry.externalDocs = options.externalDocs;
        tags.push(entry);
    }
    return tags;
};

/**
 * Generate an OpenAPI 3.1.0 document from a routes.
 *
 * Returns a renderer — call it with `'json'` for the document object or `'yaml'` for a YAML string.
 *
 * See {@link GenerateOpenApiOptions} for all options.
 *
 * ```ts
 * import { routes } from './routes';
 *
 * const spec = openapi(routes, {
 *     info: { title: 'My API', version: '1.0.0' },
 *     setOperationId: true,
 * });
 *
 * app.get('/openapi.json', (_req, res) => res.json(spec('json')));
 * app.get('/openapi.yaml', (_req, res) => res.send(spec('yaml')));
 * ```
 */
export function generateOpenApi(contract: Contract, options: GenerateOpenApiOptions): OpenApiRenderer {
    const renderer = openApiGenerator(contract, { ...options, tagLookup: buildTagLookup(contract) });
    const tags = tagsFromContract(contract);
    if (tags.length > 0) {
        const originalJson = renderer('json') as OpenApiDocument;
        const existingTags = originalJson.tags ?? [];
        const existingNames = new Set(existingTags.map((tag) => tag.name));
        const newTags = tags.filter((tag) => !existingNames.has(tag.name));
        if (newTags.length > 0) {
            originalJson.tags = [...existingTags, ...newTags];
        }
    }
    return renderer;
}
