import { z } from 'zod';
import type { Contract } from '@ts-kizuna/core';
import { contractOf, createPlugin, raw } from '@ts-kizuna/core/adapter';
import { renderOpenApi, OPENAPI_OPTIONS, type GenerateOpenApiOptions } from './generator.js';
import { renderDocsHtml, type DocsProvider } from './docs-html.js';

export interface OpenApiPluginProps extends GenerateOpenApiOptions {
    /**
     * Where the reference UI is served, or `false` to serve none.
     *
     * @default '/docs'
     */
    docsPath?: `/${string}` | false;

    /**
     * Where the document is served. `true` for `/openapi.json`. The UI embeds
     * it, so this is only for publishing the raw file.
     *
     * @default false
     */
    jsonPath?: `/${string}` | true;

    /**
     * Where the document is served as YAML. `true` for `/openapi.yaml`.
     *
     * @default false
     */
    yamlPath?: `/${string}` | true;

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

const HTML = 'text/html; charset=utf-8';
const JSON_TYPE = 'application/json';
const YAML = 'text/yaml; charset=utf-8';

const sent = (body: string, contentType: string): Response =>
    new Response(body, {
        status: 200,
        headers: {
            'content-type': contentType,
        },
    });

/**
 * Serve an API reference UI for the contract's OpenAPI document, and the
 * document itself if you publish it. Installing it is the whole setup.
 *
 * The routes are public. Gate them with your framework's own middleware if that
 * is not what you want.
 *
 * @example
 * ```ts
 * export const k = new Kizuna({
 *     tags,
 *     plugins: {
 *         openApiDocs: openApiPlugin({
 *             info: {
 *                 title: 'My API',
 *                 version: '1.0.0',
 *             },
 *         }),
 *     },
 * });
 * ```
 */
export const openApiPlugin = (props: OpenApiPluginProps) => {
    const resolve = (value: `/${string}` | boolean | undefined, fallback: `/${string}`, onByDefault: boolean): `/${string}` | undefined => {
        if (value === true) return fallback;
        if (value === false) return undefined;
        return value ?? (onByDefault ? fallback : undefined);
    };

    const docsPath = resolve(props.docsPath, '/docs', true);
    const jsonPath = resolve(props.jsonPath, '/openapi.json', false);
    const yamlPath = resolve(props.yamlPath, '/openapi.yaml', false);

    const plugin = createPlugin({
        name: 'openApiDocs',
        routes: {
            ...(docsPath === undefined
                ? {}
                : {
                      page: {
                          method: 'GET',
                          path: docsPath,
                          summary: 'API reference',
                          responses: {
                              200: z.string(),
                          },
                      },
                  }),
            ...(jsonPath === undefined
                ? {}
                : {
                      json: {
                          method: 'GET',
                          path: jsonPath,
                          summary: 'OpenAPI document',
                          responses: {
                              200: z.unknown(),
                          },
                      },
                  }),
            ...(yamlPath === undefined
                ? {}
                : {
                      yaml: {
                          method: 'GET',
                          path: yamlPath,
                          summary: 'OpenAPI document, as YAML',
                          responses: {
                              200: z.string(),
                          },
                      },
                  }),
        },
        server: (_config: void, api: unknown) => {
            const spec = renderOpenApi(contractOf<Contract>(api), props);

            return {
                router: {
                    page: () =>
                        raw(
                            sent(
                                renderDocsHtml({
                                    specUrl: jsonPath,
                                    specContent: jsonPath === undefined ? spec('json') : undefined,
                                    provider: props.provider,
                                    pageTitle: props.pageTitle ?? spec('json').info.title,
                                    cdnUrl: props.cdnUrl,
                                    configuration: props.configuration,
                                }),
                                HTML
                            )
                        ),
                    json: () => raw(sent(JSON.stringify(spec('json')), JSON_TYPE)),
                    yaml: () => raw(sent(spec('yaml'), YAML)),
                },
            };
        },
    });

    // Stamped rather than typed, so it stays out of the plugin's public type.
    (plugin as unknown as Record<symbol, GenerateOpenApiOptions>)[OPENAPI_OPTIONS] = props;

    return plugin;
};
