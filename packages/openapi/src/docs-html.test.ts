import { describe, expect, it } from 'vitest';
import { renderDocsHtml } from './docs-html.js';

describe('renderDocsHtml', () => {
    describe('scalar', () => {
        const html = renderDocsHtml({
            specUrl: '/openapi.json',
        });

        it('loads the pinned Scalar bundle from the default CDN', () => {
            expect(html).toContain('<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1"></script>');
        });

        it('initializes the reference against the spec url', () => {
            expect(html).toContain("Scalar.createApiReference('#app'");
            expect(html).toContain('"url": "/openapi.json"');
        });

        it('is the default provider', () => {
            expect(
                renderDocsHtml({
                    specUrl: '/openapi.json',
                    provider: 'scalar',
                })
            ).toBe(html);
        });

        it('titles the page "API Reference" when no title is given', () => {
            expect(html).toContain('<title>API Reference</title>');
        });

        it('serves the script from cdnUrl when given', () => {
            const selfHosted = renderDocsHtml({
                specUrl: '/openapi.json',
                cdnUrl: '/assets/scalar.js',
            });

            expect(selfHosted).toContain('<script src="/assets/scalar.js"></script>');
            expect(selfHosted).not.toContain('cdn.jsdelivr.net');
        });

        it('merges extra configuration into the initializer', () => {
            const themed = renderDocsHtml({
                specUrl: '/openapi.json',
                configuration: {
                    theme: 'purple',
                },
            });

            expect(themed).toContain('"theme": "purple"');
            expect(themed).toContain('"url": "/openapi.json"');
        });
    });

    describe('swagger', () => {
        const html = renderDocsHtml({
            specUrl: '/openapi.json',
            provider: 'swagger',
        });

        it('loads the stylesheet and bundle from the default CDN directory', () => {
            expect(html).toContain('href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css"');
            expect(html).toContain('src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"');
        });

        it('mounts on the app container', () => {
            expect(html).toContain('SwaggerUIBundle(');
            expect(html).toContain('"dom_id": "#app"');
            expect(html).toContain('"url": "/openapi.json"');
        });

        it('treats cdnUrl as a directory and tolerates a trailing slash', () => {
            const selfHosted = renderDocsHtml({
                specUrl: '/openapi.json',
                provider: 'swagger',
                cdnUrl: '/assets/swagger/',
            });

            expect(selfHosted).toContain('href="/assets/swagger/swagger-ui.css"');
            expect(selfHosted).toContain('src="/assets/swagger/swagger-ui-bundle.js"');
        });
    });

    describe('escaping', () => {
        it('escapes markup in the page title', () => {
            const html = renderDocsHtml({
                specUrl: '/openapi.json',
                pageTitle: '<script>alert(1)</script>',
            });

            expect(html).toContain('<title>&lt;script&gt;alert(1)&lt;/script&gt;</title>');
        });

        it('escapes markup in the cdn url', () => {
            const html = renderDocsHtml({
                specUrl: '/openapi.json',
                cdnUrl: '/assets/scalar.js"></script><script>alert(1)</script>',
            });

            expect(html).not.toContain('<script>alert(1)</script>');
        });

        it('keeps a closing script tag inside configuration from breaking out', () => {
            const html = renderDocsHtml({
                specUrl: '/openapi.json',
                configuration: {
                    customCss: '</script><script>alert(1)</script>',
                },
            });

            expect(html).not.toContain('</script><script>alert(1)');
            expect(html).toContain('\\u003c/script>');
        });
    });
});
