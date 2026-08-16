interface SupportsProps {
    items: string[];
}

/**
 * A row of tags naming what a page's subject works with.
 */
export function Supports({ items }: SupportsProps) {
    return (
        <div className="my-6 flex flex-col gap-2.5">
            <span className="text-xs font-semibold tracking-wide text-fd-muted-foreground uppercase">Supports</span>
            <div className="flex flex-wrap gap-2">
                {items.map((item) => (
                    <span key={item} className="rounded-lg border bg-fd-card px-3 py-1.5 text-sm font-medium text-fd-foreground">
                        {item}
                    </span>
                ))}
            </div>
        </div>
    );
}
