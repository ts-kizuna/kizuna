import { KizunaServer } from '@ts-kizuna/hono';
import { contract } from '@ts-kizuna-demo/shared';

export const { server } = KizunaServer.init(contract);
