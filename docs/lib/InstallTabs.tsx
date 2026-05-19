'use client';

import { Tab, Tabs } from 'fumadocs-ui/components/tabs';

interface InstallTabsProps {
    packageName: string;
}

export function InstallTabs({ packageName }: InstallTabsProps) {
    return (
        <Tabs groupId="package-manager" items={['pnpm', 'bun', 'npm']}>
            <Tab value="pnpm">
                <pre>
                    <code>{`pnpm add ${packageName}`}</code>
                </pre>
            </Tab>
            <Tab value="bun">
                <pre>
                    <code>{`bun add ${packageName}`}</code>
                </pre>
            </Tab>
            <Tab value="npm">
                <pre>
                    <code>{`npm install ${packageName}`}</code>
                </pre>
            </Tab>
        </Tabs>
    );
}
