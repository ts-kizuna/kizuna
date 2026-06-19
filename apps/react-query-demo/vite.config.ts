import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Proxy `/api` to the Express demo server (`pnpm --filter @ts-kizuna-demo/express server`)
// so the browser never makes a cross-origin request.
export default defineConfig({
    plugins: [react()],
    server: {
        proxy: {
            '/api': {
                target: 'http://localhost:8000',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api/, ''),
            },
        },
    },
});
