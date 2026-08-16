import { KizunaServer } from '@ts-kizuna/server/express';
import { contract } from '@ts-kizuna-demo/shared';

export const server = new KizunaServer(contract);
