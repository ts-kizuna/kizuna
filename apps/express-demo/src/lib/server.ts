import { KizunaServer } from '@ts-kizuna/express';
import { contract } from '@ts-kizuna-demo/shared';

export const { server } = KizunaServer.init(contract);
