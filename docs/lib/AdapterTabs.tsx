'use client';

import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import { DynamicCodeBlock } from 'fumadocs-ui/components/dynamic-codeblock';
import { InstallTabs } from './InstallTabs';

interface AdapterTabsProps {
    functionName: string;
    adapters?: Array<string | { label: string; package: string }>;
    showInstall?: boolean;
}

const adapterPackages: Record<string, string> = {
    Express: '@ts-kizuna/express',
    Hono: '@ts-kizuna/hono',
    'Next.js': '@ts-kizuna/next',
    Payload: '@ts-kizuna/payload',
};

function resolveAdapter(adapter: string | { label: string; package: string }) {
    if (typeof adapter === 'string') {
        return {
            label: adapter,
            package: adapterPackages[adapter],
        };
    }
    return adapter;
}

export function AdapterTabs({ functionName, adapters = ['Express', 'Hono', 'Next.js', 'Payload'], showInstall = true }: AdapterTabsProps) {
    const resolved = adapters.map(resolveAdapter);
    return (
        <Tabs groupId="adapter" items={resolved.map((adapter) => adapter.label)}>
            {resolved.map((adapter) => (
                <Tab key={adapter.label} value={adapter.label}>
                    {showInstall ? (
                        <div className="flex flex-col gap-2 [&>*:first-child]:mt-0">
                            <InstallTabs packageName={adapter.package} />
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
