import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * Wrap your Next.js config so the `.kizuna/` deprecation data is bundled into
 * serverless functions (Vercel and similar). It merges into
 * `outputFileTracingIncludes`, preserving anything you already set there, so it
 * composes with other config wrappers.
 *
 * `.kizuna/` is expected at the tracing root: your project root by default, or
 * `outputFileTracingRoot` when set. In a monorepo, set `outputFileTracingRoot`
 * to the repo root (where you run `kizuna deprecations`) and the include glob is
 * derived from it.
 *
 * ```ts
 * // next.config.ts
 * import { withKizuna } from '@ts-kizuna/next/config';
 *
 * export default withKizuna({
 *     // your config
 * });
 * ```
 */
export const withKizuna = (config: NextConfig = {}): NextConfig => {
    const root = config.outputFileTracingRoot ?? process.cwd();
    const relativeDir = path.relative(process.cwd(), path.join(root, '.kizuna')).split(path.sep).join('/');
    const existing = config.outputFileTracingIncludes ?? {};
    return {
        ...config,
        outputFileTracingIncludes: {
            ...existing,
            '/*': [...(existing['/*'] ?? []), `${relativeDir}/**/*`],
        },
    };
};
