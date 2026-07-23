import { createServer } from '@ts-kizuna/hono';
import { contract } from '@ts-kizuna-demo/shared';

export const { server } = createServer(contract);
