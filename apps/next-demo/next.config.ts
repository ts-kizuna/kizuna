import type { NextConfig } from 'next';
import { withKizuna } from '@ts-kizuna/next/config';

const config: NextConfig = {
    transpilePackages: ['@ts-kizuna/core', '@ts-kizuna/next', '@ts-kizuna-demo/shared'],
};

export default withKizuna(config);
