import { docs } from 'fumadocs-mdx:collections/server';
import { loader } from 'fumadocs-core/source';
import { Badge } from '@/components/shared/badge';

/**
 * Sidebar badges, keyed by page url. Add or remove an entry to change what a
 * page is labelled with, or drop the entry to remove the badge entirely.
 */
const badges: Record<string, string> = {
    '/docs/authentication': 'Beta',
    '/docs/jobs': 'Beta',
    '/docs/mcp': 'Beta',
    '/docs/extend/create-adapter': 'Beta',
    '/docs/extend/create-generator': 'Beta',
    '/docs/extend/create-plugin': 'Beta',
    '/docs/extend/create-job-transport': 'Beta',
    '/docs/extend/create-ts-client': 'Beta',
    '/docs/clients/kotlin': 'Beta',
    '/docs/clients/tanstack-query': 'Beta',
    '/docs/reference/kizuna-identity': 'Beta',
    '/docs/reference/k-auth': 'Beta',
    '/docs/reference/k-jobs': 'Beta',
    '/docs/reference/server-guard': 'Beta',
    '/docs/reference/server-jobs': 'Beta',
    '/docs/reference/kizuna-tanstack-query': 'Beta',
    '/docs/reference/generate-kotlin-client': 'Beta',
    '/docs/reference/mcp-plugin': 'Beta',
    '/docs/reference/create-mcp-server': 'Beta',
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
