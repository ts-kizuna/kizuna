import type { NextConfig } from 'next';
import { withKizuna } from '@ts-kizuna/next/config';

const config: NextConfig = {
    transpilePackages: ['@ts-kizuna/core', '@ts-kizuna/ai', '@ts-kizuna/next'],
};

export default withKizuna(config);
