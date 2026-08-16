import { KizunaServer } from '@ts-kizuna/server/hono';
import { contract } from '@ts-kizuna-demo/shared';

export const server = new KizunaServer(contract);
