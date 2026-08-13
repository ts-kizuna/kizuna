import { docs } from 'fumadocs-mdx:collections/server';
import { loader } from 'fumadocs-core/source';
import { Badge } from '@/components/shared/badge';

/**
 * Sidebar badges, keyed by page url. Add or remove an entry to change what a
 * page is labelled with, or drop the entry to remove the badge entirely.
 */
const badges: Record<string, string> = {
    '/docs/jobs': 'Beta',
    '/docs/mcp': 'Beta',
    '/docs/extend/create-plugin': 'Beta',
    '/docs/extend/create-job-transport': 'Beta',
    '/docs/clients/kotlin': 'Beta',
    '/docs/deprecations': 'Beta',
};

export const source = loader({
    baseUrl: '/docs',
    source: docs.toFumadocsSource(),
    pageTree: {
        transformers: [
            {
                file(node) {
                    const label = node.type === 'page' ? badges[node.url] : undefined;
                    if (!label) return node;

                    return {
                        ...node,
                        name: (
                            <>
                                {node.name}
                                <Badge>{label}</Badge>
                            </>
                        ),
                    };
                },
            },
        ],
    },
});
