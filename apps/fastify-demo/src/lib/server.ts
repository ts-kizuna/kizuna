import { KizunaServer } from '@ts-kizuna/fastify';
import { contract } from '@ts-kizuna-demo/shared';

export const server = new KizunaServer(contract);
