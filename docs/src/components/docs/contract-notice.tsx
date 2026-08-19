import { Notice } from './notice';

export function ContractNotice() {
    return (
        <Notice>Every client imports the contract, so treat it like frontend code. Keep API keys and other secrets in the server.</Notice>
    );
}
