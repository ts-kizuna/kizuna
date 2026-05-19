import { defineConfig, defineDocs } from 'fumadocs-mdx/config';
import { transformerTwoslash } from 'fumadocs-twoslash';
import { rehypeCodeDefaultOptions } from 'fumadocs-core/mdx-plugins';
import { transformerNotationDiff, transformerNotationHighlight } from '@shikijs/transformers';

export const docs = defineDocs({
    dir: 'content/docs',
});

export default defineConfig({
    mdxOptions: {
        rehypeCodeOptions: {
            themes: {
                light: 'github-light',
                dark: 'github-dark',
            },
            transformers: [
                ...(rehypeCodeDefaultOptions.transformers ?? []),
                transformerTwoslash(),
                transformerNotationDiff(),
                transformerNotationHighlight(),
            ],
        },
    },
});
