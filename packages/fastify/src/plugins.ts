export type { KizunaPlugin } from '@ts-kizuna/core/adapter';

import type { FastifyInstance } from 'fastify';

/**
 * What a plugin registers on under Fastify: the instance itself, so a plugin
 * can `app.register(...)` and get Fastify's usual encapsulation.
 */
export type App = FastifyInstance;
