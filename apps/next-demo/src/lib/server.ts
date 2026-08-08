import { KizunaServer } from '@ts-kizuna/next';
import { contract } from '@ts-kizuna-demo/shared';

export const { server } = KizunaServer.init(contract);
