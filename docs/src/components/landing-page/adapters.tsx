import { Info } from 'lucide-react';
import { CodeWindow } from '@/components/code/code-window';
import { TsLogo } from '@/components/code/brand-icons';
import { AdapterSwitcher } from './adapter-switcher';
import type { AdapterOption } from './adapter-switcher';
import styles from './adapters.module.css';

const tsIcon = <TsLogo className={styles.fileIcon} />;

const adapters: AdapterOption[] = [
    {
        id: 'express',
        name: 'Express',
        context: 'req, res',
        visual: (
            <CodeWindow
                lang="ts"
                title="src/index.ts"
                icon={tsIcon}
                dots
                code={`import express from 'express';
import { api } from './server/api';

const app = express();
app.use(express.json());

api.mount(app);

app.listen(3000);`}
            />
        ),
    },
    {
        id: 'fastify',
        name: 'Fastify',
        context: 'request, reply',
        visual: (
            <CodeWindow
                lang="ts"
                title="src/index.ts"
                icon={tsIcon}
                dots
                code={`import Fastify from 'fastify';
import { api } from './server/api';

const app = Fastify();
await api.mount(app);

app.listen({
    port: 3000,
});`}
            />
        ),
    },
    {
        id: 'hono',
        name: 'Hono',
        context: 'c, c.env',
        visual: (
            <CodeWindow
                lang="ts"
                title="src/index.ts"
                icon={tsIcon}
                dots
                code={`import { Hono } from 'hono';
import { api } from './server/api';

const app = new Hono();
api.mount(app);

export default app;`}
            />
        ),
    },
    {
        id: 'next',
        name: 'Next.js',
        context: 'request',
        visual: (
            <CodeWindow
                lang="ts"
                title="src/app/api/[...ts-kizuna]/route.ts"
                icon={tsIcon}
                dots
                code={`import { api } from '@/server/api';

export const { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS } = api.mount({
    basePath: '/api',
});`}
            />
        ),
    },
];

export function Adapters() {
    return (
        <div className={styles.adapters}>
            <AdapterSwitcher options={adapters} />
            <p className={styles.note}>
                <Info className={styles.noteIcon} aria-hidden />
                For Cloudflare Workers, Deno, or Bun, use the Hono adapter.
            </p>
        </div>
    );
}
