import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['dev/int.spec.ts'],
        hookTimeout: 30_000,
        testTimeout: 30_000,
    },
});
