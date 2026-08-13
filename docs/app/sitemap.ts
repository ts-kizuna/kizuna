import type { MetadataRoute } from 'next';
import { source } from '@/lib/source';
import { siteUrl } from '@/lib/site';

const landingPages = ['/', '/faq'];

export default function sitemap(): MetadataRoute.Sitemap {
    return [...landingPages, ...source.getPages().map((page) => page.url)].map((path) => ({
        url: new URL(path, siteUrl).href,
    }));
}
