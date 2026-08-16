import type { RouteDefinition } from '@ts-kizuna/contract/generator';

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
    /**
     * The `custom` schemes guarding this operation. They emit no `security`
     * requirement, so this marks the operation as protected, not public.
     */
    'x-kizuna-guarded'?: string[];
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
    externalDocs?: OpenApiExternalDocs;
    setOperationId?: boolean | 'concatenated-path';
    operationMapper?: (operation: OpenApiOperation, route: RouteDefinition, operationId: string) => OpenApiOperation;
}

export interface OpenApiRenderer {
    (format: 'json'): OpenApiDocument;
    (format: 'yaml'): string;
}
