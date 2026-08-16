import { defineConfig } from 'tsdown';

/**
 * Named entries, so each adapter lands at a predictable `dist` path the
 * exports map can point at. `fastify-plugin` is bundled rather than external:
 * it is a dependency of one adapter, and every other adapter's users would
 * otherwise install it.
 */
export default defineConfig({
    entry: {
        index: 'src/adapter.ts',
        jobs: 'src/jobs-entry.ts',
        express: 'src/express/index.ts',
        fastify: 'src/fastify/index.ts',
        hono: 'src/hono/index.ts',
        next: 'src/next/index.ts',
        'next-config': 'src/next/config.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    external: ['@ts-kizuna/contract', '@ts-kizuna/contract', 'express', 'fastify', 'hono', 'next', 'zod'],
});
