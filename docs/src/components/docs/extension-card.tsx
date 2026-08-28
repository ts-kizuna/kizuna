export function ExtensionCard() {
    return (
        <div className="not-prose my-4 flex flex-col gap-4 rounded-lg border bg-fd-card p-4 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-4 sm:items-center">
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
                <div className="flex min-w-0 flex-col gap-2 leading-none">
                    <div className="flex flex-col gap-1">
                        <span className="mb-px font-semibold">ts-kizuna</span>
                        <span className="text-sm text-fd-muted-foreground">Deprecation strikethroughs and hovers.</span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                        <a
                            className="whitespace-nowrap text-fd-muted-foreground underline hover:text-fd-foreground"
                            href="https://marketplace.visualstudio.com/items?itemName=ts-kizuna.ts-kizuna-vscode"
                            rel="noreferrer"
                            target="_blank">
                            VS Code Marketplace
                        </a>
                        <a
                            className="whitespace-nowrap text-fd-muted-foreground underline hover:text-fd-foreground"
                            href="https://open-vsx.org/extension/ts-kizuna/ts-kizuna-vscode"
                            rel="noreferrer"
                            target="_blank">
                            Open VSX
                        </a>
                    </div>
                </div>
            </div>
            <a
                className="shrink-0 rounded-md bg-fd-primary px-3.5 py-2 text-center text-sm font-medium text-fd-primary-foreground hover:opacity-90 sm:py-1.5"
                href="vscode:extension/ts-kizuna.ts-kizuna-vscode">
                Install
            </a>
        </div>
    );
}
