import type { NextConfig } from 'next';
import { withKizuna } from '@ts-kizuna/server/next/config';

const config: NextConfig = {
    transpilePackages: ['@ts-kizuna/contract', '@ts-kizuna/server/next', '@ts-kizuna-demo/shared'],
};

export default withKizuna(config);
