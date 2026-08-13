import { readFile } from 'node:fs/promises';
import { source } from '@/lib/source';

export const revalidate = false;

export async function GET() {
    const pages = source.getPages();

    const documents = await Promise.all(
        pages.map(async (page) => {
            if (!page.absolutePath) return undefined;
            const raw = await readFile(page.absolutePath, 'utf8');
            return `# ${page.data.title}\nSource: ${page.url}\n\n${raw}`;
        })
    );

    return new Response(documents.filter(Boolean).join('\n\n---\n\n'), {
        headers: {
            'content-type': 'text/plain; charset=utf-8',
        },
    });
}
