import { createJiti } from 'jiti';
import type { Contract } from '@ts-kizuna/shared';

/**
 * Imports a contract module with jiti (so a `.ts` entry works without a build
 * step) and returns the named export (default `contract`) or the default export.
 * Returns undefined when neither is present.
 */
export const loadContract = async (contractPath: string, exportName: string = 'contract'): Promise<Contract | undefined> => {
    const jiti = createJiti(import.meta.url, {
        interopDefault: true,
    });
    const loaded = (await jiti.import(contractPath)) as Record<string, Contract | undefined>;
    return loaded[exportName] ?? loaded.default;
};
