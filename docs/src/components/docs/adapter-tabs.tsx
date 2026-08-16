'use client';

import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import { DynamicCodeBlock } from 'fumadocs-ui/components/dynamic-codeblock';
import { InstallTabs } from './install-tabs';
import styles from './adapter-tabs.module.css';

interface Adapter {
    label: string;
    /**
     * What the import comes from, a subpath of the package named by `install`.
     */
    package: string;
    /**
     * What `pnpm add` takes, which a subpath cannot be.
     */
    install: string;
}

interface AdapterTabsProps {
    functionName: string;
    adapters?: Array<string | Adapter>;
    showInstall?: boolean;
}

const adapterPackages: Record<string, Omit<Adapter, 'label'>> = {
    Express: {
        package: '@ts-kizuna/server/express',
        install: '@ts-kizuna/server express',
    },
    Fastify: {
        package: '@ts-kizuna/server/fastify',
        install: '@ts-kizuna/server fastify',
    },
    Hono: {
        package: '@ts-kizuna/server/hono',
        install: '@ts-kizuna/server hono',
    },
    'Next.js': {
        package: '@ts-kizuna/server/next',
        install: '@ts-kizuna/server',
    },
};

function resolveAdapter(adapter: string | Adapter): Adapter {
    if (typeof adapter === 'string') {
        return {
            label: adapter,
            ...adapterPackages[adapter]!,
        };
    }
    return adapter;
}

export function AdapterTabs({ functionName, adapters = ['Express', 'Fastify', 'Hono', 'Next.js'], showInstall = true }: AdapterTabsProps) {
    const resolved = adapters.map(resolveAdapter);
    return (
        <Tabs groupId="adapter" items={resolved.map((adapter) => adapter.label)}>
            {resolved.map((adapter) => (
                <Tab key={adapter.label} value={adapter.label}>
                    {showInstall ? (
                        <div className={styles.install}>
                            <InstallTabs packageName={adapter.install} />
                            <DynamicCodeBlock lang="ts" code={`import { ${functionName} } from '${adapter.package}';`} />
                        </div>
                    ) : (
                        <DynamicCodeBlock lang="ts" code={`import { ${functionName} } from '${adapter.package}';`} />
                    )}
                </Tab>
            ))}
        </Tabs>
    );
}
