export {
    type DeprecationMap,
    type SerializedDeprecationMap,
    serializeDeprecationMap,
    deserializeDeprecationMap,
} from '@ts-kizuna/core/generator';
export {
    generateOpenApi,
    type GenerateOpenApiOptions,
    type OpenApiRenderer,
    type OpenApiDocument,
    type OpenApiInfo,
    type OpenApiOperation,
    type OpenApiParameter,
    type OpenApiResponseObject,
    type OpenApiServer,
    type OpenApiVersion,
} from './generator.js';
export { openApiPlugin, type OpenApiPluginProps } from './plugin.js';
export { renderDocsHtml, type DocsProvider, type DocsHtmlOptions } from './docs-html.js';
