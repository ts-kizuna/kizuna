import { KizunaServer } from '@ts-kizuna/server/fastify';
import { contract } from '@ts-kizuna-demo/shared';

export const server = new KizunaServer(contract);
