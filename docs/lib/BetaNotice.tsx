import type { ReactNode } from 'react';

interface BetaNoticeProps {
    children: ReactNode;
}

export function BetaNotice({ children }: BetaNoticeProps) {
    return (
        <div className="my-4 flex flex-col gap-1 rounded-lg border bg-fd-card px-4 py-3 text-sm">
            <span className="font-semibold tracking-wide text-fd-primary uppercase">Beta</span>
            <div className="text-fd-muted-foreground [&>p]:m-0 [&>p+p]:mt-2">{children}</div>
        </div>
    );
}
