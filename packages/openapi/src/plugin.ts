import { z } from 'zod';
import { createPlugin, type RoutePath } from '@ts-kizuna/contract/plugin';
import type { DocsProvider } from './docs-html.js';
import type { GenerateOpenApiOptions } from './types.js';

export const OPENAPI_PLUGIN_NAME = 'openApi';

export type JsonDocumentPath = `${RoutePath}.json`;

export type YamlDocumentPath = `${RoutePath}.yaml`;

export interface OpenApiPluginProps extends GenerateOpenApiOptions {
    /**
     * Where the reference UI is served.
     */
    docsPath?: RoutePath;

    /**
     * Where the document is served. The UI embeds it, so this is only for
     * publishing the file.
     */
    jsonPath?: JsonDocumentPath;

    /**
     * Where the document is served as YAML.
     */
    yamlPath?: YamlDocumentPath;

    /**
     * Which API reference UI to render.
     *
     * @default 'scalar'
     */
    provider?: DocsProvider;

    /**
     * Where to load the UI's assets from, for a self-hosted copy. The script
     * URL for `'scalar'`; the directory holding `swagger-ui.css` and
     * `swagger-ui-bundle.js` for `'swagger'`.
     */
    cdnUrl?: string;

    /**
     * The page's `<title>`.
     *
     * @default the document's `info.title`
     */
    pageTitle?: string;

    /**
     * Merged into `Scalar.createApiReference` or `SwaggerUIBundle`.
     */
    configuration?: Record<string, unknown>;
}

/**
 * Serve an API reference UI for the contract's OpenAPI document, and the
 * document itself if you publish it.
 *
 * Pass `openApiPluginServer()` from `@ts-kizuna/openapi/server` to
 * `server.api({ plugins })` to serve it.
 *
 * The routes are public. Gate them with your framework's own middleware if that
 * is not what you want.
 *
 * @example
 * ```ts
 * export const k = new Kizuna({
 *     tags,
 *     plugins: {
 *         openApi: openApiPlugin({
 *             info: {
 *                 title: 'My API',
 *                 version: '1.0.0',
 *             },
 *         }),
 *     },
 * });
 * ```
 */
export const openApiPlugin = (props: OpenApiPluginProps) =>
    createPlugin({
        name: OPENAPI_PLUGIN_NAME,
        serverModule: '@ts-kizuna/openapi/server',
        routes: {
            ...(props.docsPath === undefined
                ? {}
                : {
                      page: {
                          method: 'GET',
                          path: props.docsPath,
                          summary: 'API reference',
                          responses: {
                              200: z.string(),
                          },
                      },
                  }),
            ...(props.jsonPath === undefined
                ? {}
                : {
                      json: {
                          method: 'GET',
                          path: props.jsonPath,
                          summary: 'OpenAPI document',
                          responses: {
                              200: z.unknown(),
                          },
                      },
                  }),
            ...(props.yamlPath === undefined
                ? {}
                : {
                      yaml: {
                          method: 'GET',
                          path: props.yamlPath,
                          summary: 'OpenAPI document, as YAML',
                          responses: {
                              200: z.string(),
                          },
                      },
                  }),
        },
        props,
    });
