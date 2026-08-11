import type { Contract } from '@ts-kizuna/core';
import { contractOf, implementPlugin, rawResponse } from '@ts-kizuna/core/adapter';
import { openApiPlugin } from './plugin.js';
import { renderOpenApi } from './generator.js';
import { renderDocsHtml } from './docs-html.js';

export { generateOpenApi, renderOpenApi } from './generator.js';
export { renderDocsHtml, type DocsProvider, type DocsHtmlOptions } from './docs-html.js';
export {
    type DeprecationMap,
    type SerializedDeprecationMap,
    serializeDeprecationMap,
    deserializeDeprecationMap,
} from '@ts-kizuna/core/generator';

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
 * Serve the `openApiPlugin` declared on the contract: the reference UI, and the
 * document itself where the declaration published it.
 *
 * @example
 * ```ts
 * export const api = server.api({
 *     router,
 *     plugins: {
 *         openApi: openApiPluginServer(),
 *     },
 * });
 * ```
 */
export const openApiPluginServer = () =>
    implementPlugin(openApiPlugin, ({ props, api }) => {
        const spec = renderOpenApi(contractOf<Contract>(api), props);

        return {
            router: {
                page: () =>
                    rawResponse(
                        sent(
                            renderDocsHtml({
                                specUrl: props.jsonPath,
                                specContent: props.jsonPath === undefined ? spec('json') : undefined,
                                provider: props.provider,
                                pageTitle: props.pageTitle ?? spec('json').info.title,
                                cdnUrl: props.cdnUrl,
                                configuration: props.configuration,
                            }),
                            HTML
                        )
                    ),
                json: () => rawResponse(sent(JSON.stringify(spec('json')), JSON_TYPE)),
                yaml: () => rawResponse(sent(spec('yaml'), YAML)),
            },
        };
    });
