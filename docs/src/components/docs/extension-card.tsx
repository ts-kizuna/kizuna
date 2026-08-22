export function ExtensionCard() {
    return (
        <div className="not-prose my-4 flex items-center gap-4 rounded-lg border bg-fd-card p-4">
            <img
                src="/favicon-dark.png"
                alt="ts-kizuna extension icon"
                width={56}
                height={56}
                className="size-14 shrink-0 rounded-xl dark:hidden"
            />
            <img
                src="/favicon-light.png"
                alt="ts-kizuna extension icon"
                width={56}
                height={56}
                className="hidden size-14 shrink-0 rounded-xl dark:block"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-semibold">ts-kizuna</span>
                <span className="text-sm text-fd-muted-foreground">Deprecation strikethroughs, hovers, and completions.</span>
                <div className="mt-1 flex gap-3 text-xs">
                    <a
                        className="text-fd-muted-foreground underline hover:text-fd-foreground"
                        href="https://marketplace.visualstudio.com/items?itemName=ts-kizuna.ts-kizuna-vscode"
                        rel="noreferrer"
                        target="_blank">
                        Marketplace
                    </a>
                </div>
            </div>
            <a
                className="mr-2 shrink-0 rounded-md bg-fd-primary px-3.5 py-1.5 text-sm font-medium text-fd-primary-foreground hover:opacity-90"
                href="vscode:extension/ts-kizuna.ts-kizuna-vscode">
                Install
            </a>
        </div>
    );
}
