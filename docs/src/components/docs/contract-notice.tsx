import { Info } from 'lucide-react';

export function ContractNotice() {
    return (
        <div className="my-4 flex items-start gap-2.5 rounded-lg border bg-fd-card px-4 py-3 text-sm text-fd-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" />
            <span>Every client imports the contract, so treat it like frontend code. Keep API keys and other secrets in the server.</span>
        </div>
    );
}
