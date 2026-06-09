'use client';

import { Tab, Tabs } from 'fumadocs-ui/components/tabs';

interface InstallTabsProps {
    packageName: string;
    /**
     * Render the commands as dev-dependency installs (`-D` / `--save-dev`).
     */
    dev?: boolean;
}

export function InstallTabs({ packageName, dev = false }: InstallTabsProps) {
    const flags = {
        pnpm: dev ? '-D ' : '',
        bun: dev ? '-d ' : '',
        npm: dev ? '--save-dev ' : '',
    };
    return (
        <Tabs groupId="package-manager" items={['pnpm', 'bun', 'npm']}>
            <Tab value="pnpm">
                <pre>
                    <code>{`pnpm add ${flags.pnpm}${packageName}`}</code>
                </pre>
            </Tab>
            <Tab value="bun">
                <pre>
                    <code>{`bun add ${flags.bun}${packageName}`}</code>
                </pre>
            </Tab>
            <Tab value="npm">
                <pre>
                    <code>{`npm install ${flags.npm}${packageName}`}</code>
                </pre>
            </Tab>
        </Tabs>
    );
}
