import path from 'path';
import { fileURLToPath } from 'url';
import { buildConfig } from 'payload';
import { sqliteAdapter } from '@payloadcms/db-sqlite';
import { kizunaPlugin } from '@ts-kizuna/payload';
import { api } from './lib/api';

const dirname = path.dirname(fileURLToPath(import.meta.url));

const devUser = {
    email: 'dev@payloadcms.com',
    password: 'test',
};

export default buildConfig({
    secret: 'payload-demo-secret-key',
    db: sqliteAdapter({
        client: {
            url: `file:${path.resolve(dirname, 'demo.db')}`,
        },
    }),
    collections: [
        {
            slug: 'users',
            auth: true,
            fields: [],
        },
    ],
    plugins: [kizunaPlugin(api)],
    onInit: async (payload) => {
        const { totalDocs } = await payload.count({
            collection: 'users',
            where: {
                email: {
                    equals: devUser.email,
                },
            },
        });
        if (!totalDocs) {
            await payload.create({
                collection: 'users',
                data: devUser,
            });
            payload.logger.info(`Created dev user: ${devUser.email} / ${devUser.password}`);
        }
    },
    typescript: {
        outputFile: path.resolve(dirname, 'payload-types.ts'),
    },
});
