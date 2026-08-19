import type { ReactNode } from 'react';
import { Info } from 'lucide-react';

interface NoticeProps {
    children: ReactNode;
}

export function Notice({ children }: NoticeProps) {
    return (
        <div className="my-4 flex items-start gap-2.5 rounded-lg border bg-fd-card px-4 py-3 text-sm text-fd-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" />
            <span className="[&>p]:m-0">{children}</span>
        </div>
    );
}
