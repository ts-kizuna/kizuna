import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        include: ['packages/**/*.test.ts', 'tests/**/*.test.ts'],
        typecheck: {
            enabled: true,
            tsconfig: './tsconfig.test.json',
            include: ['packages/**/*.test-d.ts'],
        },
    },
});
