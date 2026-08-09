/**
 * The API reference UI rendered by the docs endpoint.
 */
export type DocsProvider = 'scalar' | 'swagger';

const SCALAR_CDN = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1';
const SWAGGER_CDN = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5';

export interface DocsHtmlOptions {
    /**
     * URL the UI fetches the OpenAPI document from. Omit it and pass
     * {@link DocsHtmlOptions.specContent} instead.
     */
    specUrl?: string;

    /**
     * The document itself, embedded in the page rather than fetched.
     */
    specContent?: unknown;

    /**
     * Which API reference UI to render.
     *
     * @default 'scalar'
     */
    provider?: DocsProvider;

    /**
     * The page's `<title>`.
     *
     * @default 'API Reference'
     */
    pageTitle?: string;

    /**
     * Where to load the UI's assets from. Point this at a self-hosted copy for
     * air-gapped deployments or a strict CSP.
     *
     * For `'scalar'` this is the script URL. For `'swagger'` it is the
     * directory holding `swagger-ui.css` and `swagger-ui-bundle.js`.
     *
     * @default 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1' | 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5'
     */
    cdnUrl?: string;

    /**
     * Merged into `Scalar.createApiReference` or `SwaggerUIBundle`. See the
     * provider's own documentation for the available keys.
     */
    configuration?: Record<string, unknown>;
}

const escapeHtml = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * JSON for embedding in an inline `<script>`. Escaping `<` keeps a `</script>`
 * inside a config string from closing the tag early.
 */
const embedJson = (value: unknown): string => JSON.stringify(value, null, 4).replace(/</g, '\\u003c').split('\n').join('\n            ');

const scalarPage = (title: string, cdnUrl: string, configuration: Record<string, unknown>): string => `<!doctype html>
<html lang="en">
    <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${escapeHtml(title)}</title>
    </head>
    <body>
        <div id="app"></div>
        <script src="${escapeHtml(cdnUrl)}"></script>
        <script>
            Scalar.createApiReference('#app', ${embedJson(configuration)});
        </script>
    </body>
</html>
`;

const swaggerPage = (title: string, cdnUrl: string, configuration: Record<string, unknown>): string => {
    const base = cdnUrl.replace(/\/$/, '');
    return `<!doctype html>
<html lang="en">
    <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${escapeHtml(title)}</title>
        <link rel="stylesheet" href="${escapeHtml(base)}/swagger-ui.css" />
    </head>
    <body>
        <div id="app"></div>
        <script src="${escapeHtml(base)}/swagger-ui-bundle.js"></script>
        <script>
            SwaggerUIBundle(${embedJson(configuration)});
        </script>
    </body>
</html>
`;
};

/**
 * Render a self-contained page that loads an API reference UI over your OpenAPI
 * document. `openApiDocsPlugin` calls this, so reach for it directly only when
 * kizuna has no adapter for your framework.
 *
 * @example
 * ```ts
 * const html = renderDocsHtml({
 *     specUrl: '/openapi.json',
 *     pageTitle: 'My API',
 * });
 * ```
 */
export const renderDocsHtml = (options: DocsHtmlOptions): string => {
    const title = options.pageTitle ?? 'API Reference';
    const provider = options.provider ?? 'scalar';

    if (provider === 'swagger') {
        return swaggerPage(title, options.cdnUrl ?? SWAGGER_CDN, {
            dom_id: '#app',
            ...(options.specUrl ? { url: options.specUrl } : { spec: options.specContent }),
            ...options.configuration,
        });
    }

    return scalarPage(title, options.cdnUrl ?? SCALAR_CDN, {
        ...(options.specUrl ? { url: options.specUrl } : { content: options.specContent }),
        ...options.configuration,
    });
};
