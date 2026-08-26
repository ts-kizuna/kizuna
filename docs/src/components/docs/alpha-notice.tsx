import type { ReactNode } from 'react';

interface AlphaNoticeProps {
    children: ReactNode;
}

export function AlphaNotice({ children }: AlphaNoticeProps) {
    return (
        <div className="my-4 flex flex-col gap-2 rounded-lg border bg-fd-card px-4 py-3 text-sm">
            <span className="w-fit rounded-full border-[1.5px] border-fd-primary px-2 py-0.5 text-xs font-semibold tracking-wide text-fd-primary uppercase">
                Alpha
            </span>
            <div className="text-fd-muted-foreground [&>p]:m-0 [&>p+p]:mt-2">{children}</div>
        </div>
    );
}
