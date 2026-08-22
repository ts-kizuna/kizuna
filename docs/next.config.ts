import { createMDX } from 'fumadocs-mdx/next';
import type { NextConfig } from 'next';

const withMDX = createMDX();

const config: NextConfig = {
    devIndicators: false,
    serverExternalPackages: ['typescript', 'twoslash'],
    reactStrictMode: true,
    turbopack: {
        rules: {
            '*.svg': {
                loaders: [
                    {
                        loader: '@svgr/webpack',
                        options: {
                            svgo: false,
                        },
                    },
                ],
                as: '*.js',
            },
        },
    },
};

export default withMDX(config);
