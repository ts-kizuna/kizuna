import { KizunaServer } from '@ts-kizuna/fastify';
import { contract } from '@ts-kizuna-demo/shared';

export const { server } = KizunaServer.init(contract);
