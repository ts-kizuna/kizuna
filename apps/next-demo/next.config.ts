import type { NextConfig } from 'next';

const config: NextConfig = {
    transpilePackages: ['@ts-kizuna/core', '@ts-kizuna/next', '@ts-kizuna-demo/shared'],
};

export default config;
