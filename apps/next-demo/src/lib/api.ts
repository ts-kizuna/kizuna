import { createApi } from '@ts-kizuna/next';
import { contract } from '@ts-kizuna-demo/shared';
import { router } from './server';

export const api = createApi({
    contract,
    router,
});
